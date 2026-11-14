"""O que o Discord não tem: Hall da Fama, fila de vídeos da call e "onde paramos"."""

from __future__ import annotations

import re
from typing import Any

import httpx
from fastapi import APIRouter
from pydantic import BaseModel

from ..core import Auth, CurrentUser, err, new_id, parse_id, pool, sid
from ..realtime import can_access_channel, hub
from .messages import SELECT_MESSAGES, messages_out, post_message
from .servers import require_admin, require_member, role_in

router = APIRouter()


# ================================================================== Hall da Fama
async def check_hall(message_id: int, channel_id: int) -> None:
    """Chamado depois de cada reação: se N pessoas diferentes reagiram, a mensagem entra para o Hall."""
    ch = await pool().fetchrow(
        "SELECT c.server_id, s.hall_threshold FROM channels c JOIN servers s ON s.id = c.server_id WHERE c.id = $1", channel_id
    )
    if not ch:
        return  # conversa direta não tem Hall
    msg = await pool().fetchrow("SELECT author_id, kind FROM messages WHERE id = $1", message_id)
    if not msg or msg["kind"] != "default":
        return
    people = await pool().fetchval(
        "SELECT count(DISTINCT user_id) FROM reactions WHERE message_id = $1 AND user_id IS DISTINCT FROM $2",
        message_id, msg["author_id"],
    )
    if people < ch["hall_threshold"]:
        return
    added = await pool().fetchval(
        "INSERT INTO hall_entries (message_id, server_id) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING message_id",
        message_id, ch["server_id"],
    )
    if not added:
        return
    # aviso no próprio canal, apontando para a mensagem
    if msg["author_id"] is not None:
        await post_message(channel_id, msg["author_id"], "", kind="hall", reply_to=message_id)
    entry = await _hall_entries(ch["server_id"], None, "h.message_id = $2", message_id)
    if entry:
        await hub.to_server(ch["server_id"], "hall_add", {"server_id": sid(ch["server_id"]), "entry": entry[0]})


async def _hall_entries(server_id: int, viewer: int | None, extra: str, *args: Any, limit: int = 30) -> list[dict]:
    rows = await pool().fetch(
        f"""{SELECT_MESSAGES.replace('FROM messages m', ', h.added_at AS h_added_at, ch.name AS h_channel_name FROM messages m')}
            JOIN hall_entries h ON h.message_id = m.id
            JOIN channels ch ON ch.id = m.channel_id
            WHERE h.server_id = $1 AND {extra}
            ORDER BY h.added_at DESC LIMIT {int(limit)}""",
        server_id, *args,
    )
    msgs = await messages_out(list(rows), viewer or 0)
    return [
        {"message": m, "channel_name": r["h_channel_name"], "added_at": r["h_added_at"].isoformat()}
        for m, r in zip(msgs, rows)
    ]


@router.get("/servers/{server_id}/hall")
async def list_hall(server_id: str, before: str | None = None, me: Auth = CurrentUser) -> list[dict]:
    s = parse_id(server_id)
    await require_member(s, me.id)
    if before:
        cutoff = await pool().fetchval("SELECT added_at FROM hall_entries WHERE message_id = $1", parse_id(before))
        if cutoff is None:
            return []
        return await _hall_entries(s, me.id, "h.added_at < $2", cutoff)
    return await _hall_entries(s, me.id, "TRUE")


@router.delete("/servers/{server_id}/hall/{message_id}")
async def remove_from_hall(server_id: str, message_id: str, me: Auth = CurrentUser) -> dict:
    s = parse_id(server_id)
    await require_admin(s, me.id)
    mid = parse_id(message_id)
    await pool().execute("DELETE FROM hall_entries WHERE server_id = $1 AND message_id = $2", s, mid)
    await hub.to_server(s, "hall_remove", {"server_id": sid(s), "message_id": sid(mid)})
    return {"ok": True}


# ================================================================== fila de vídeos
YT_ID = re.compile(r"^[\w-]{11}$")


def parse_youtube(url: str) -> tuple[str, int] | None:
    s = url.strip()
    if YT_ID.match(s):
        return s, 0
    m = re.search(r"(?:youtu\.be/|[?&]v=|/(?:shorts|live|embed)/)([\w-]{11})", s)
    if not m:
        return None
    t = re.search(r"[?&](?:t|start)=(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s?)?", s)
    start = 0
    if t:
        start = int(t.group(1) or 0) * 3600 + int(t.group(2) or 0) * 60 + int(t.group(3) or 0)
    return m.group(1), start


async def youtube_info(video_id: str) -> tuple[str, str]:
    """Título e canal pelo oEmbed público do YouTube (sem chave de API)."""
    try:
        async with httpx.AsyncClient(timeout=4) as c:
            r = await c.get(
                "https://www.youtube.com/oembed",
                params={"url": f"https://www.youtube.com/watch?v={video_id}", "format": "json"},
            )
        if r.status_code == 200:
            d = r.json()
            return str(d.get("title", ""))[:200], str(d.get("author_name", ""))[:100]
    except Exception:
        pass
    return "", ""


async def queue_out(channel_id: int) -> list[dict]:
    rows = await pool().fetch(
        """SELECT q.*, coalesce(array_agg(v.user_id) FILTER (WHERE v.user_id IS NOT NULL), '{}') AS voters
           FROM queue_items q LEFT JOIN queue_votes v ON v.item_id = q.id
           WHERE q.channel_id = $1 GROUP BY q.id
           ORDER BY count(v.user_id) DESC, q.id ASC""",
        channel_id,
    )
    return [
        {
            "id": sid(r["id"]),
            "video_id": r["video_id"],
            "start": r["start_at"],
            "title": r["title"] or "Vídeo do YouTube",
            "author": r["author"],
            "added_by": sid(r["added_by"]) if r["added_by"] else None,
            "voters": [sid(v) for v in r["voters"]],
            "created_at": r["created_at"].isoformat(),
        }
        for r in rows
    ]


async def _queue_channel(channel_id: int, user_id: int) -> dict:
    ch = await can_access_channel(user_id, channel_id)
    if not ch or ch["type"] not in ("voice", "dm"):
        raise err(404, "Canal não encontrado.")
    return ch


async def announce_queue(channel_id: int) -> list[dict]:
    items = await queue_out(channel_id)
    await hub.to_channel(channel_id, "queue", {"channel_id": sid(channel_id), "items": items})
    return items


@router.get("/channels/{channel_id}/queue")
async def get_queue(channel_id: str, me: Auth = CurrentUser) -> list[dict]:
    cid = parse_id(channel_id)
    await _queue_channel(cid, me.id)
    return await queue_out(cid)


class QueueIn(BaseModel):
    url: str


@router.post("/channels/{channel_id}/queue")
async def add_to_queue(channel_id: str, body: QueueIn, me: Auth = CurrentUser) -> list[dict]:
    cid = parse_id(channel_id)
    await _queue_channel(cid, me.id)
    parsed = parse_youtube(body.url)
    if not parsed:
        raise err(400, "Isso não parece um link do YouTube.")
    if await pool().fetchval("SELECT count(*) FROM queue_items WHERE channel_id = $1", cid) >= 100:
        raise err(400, "A fila já tem 100 vídeos. Assistam alguns antes.")
    if await pool().fetchval("SELECT 1 FROM queue_items WHERE channel_id = $1 AND video_id = $2", cid, parsed[0]):
        raise err(400, "Esse vídeo já está na fila.")
    title, author = await youtube_info(parsed[0])
    item = new_id()
    await pool().execute(
        "INSERT INTO queue_items (id, channel_id, video_id, start_at, title, author, added_by) VALUES ($1,$2,$3,$4,$5,$6,$7)",
        item, cid, parsed[0], parsed[1], title, author, me.id,
    )
    await pool().execute("INSERT INTO queue_votes (item_id, user_id) VALUES ($1, $2)", item, me.id)
    return await announce_queue(cid)


async def _queue_item(item_id: int, user_id: int) -> Any:
    row = await pool().fetchrow("SELECT id, channel_id FROM queue_items WHERE id = $1", item_id)
    if not row or not await can_access_channel(user_id, row["channel_id"]):
        raise err(404, "Esse vídeo não está mais na fila.")
    return row


@router.put("/queue/{item_id}/vote")
async def vote(item_id: str, me: Auth = CurrentUser) -> list[dict]:
    row = await _queue_item(parse_id(item_id), me.id)
    await pool().execute("INSERT INTO queue_votes (item_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING", row["id"], me.id)
    return await announce_queue(row["channel_id"])


@router.delete("/queue/{item_id}/vote")
async def unvote(item_id: str, me: Auth = CurrentUser) -> list[dict]:
    row = await _queue_item(parse_id(item_id), me.id)
    await pool().execute("DELETE FROM queue_votes WHERE item_id = $1 AND user_id = $2", row["id"], me.id)
    return await announce_queue(row["channel_id"])


@router.delete("/queue/{item_id}")
async def remove_from_queue(item_id: str, me: Auth = CurrentUser) -> list[dict]:
    """Tirar da fila (ou "tocar agora", que tira e coloca no player)."""
    row = await _queue_item(parse_id(item_id), me.id)
    await pool().execute("DELETE FROM queue_items WHERE id = $1", row["id"])
    return await announce_queue(row["channel_id"])


# ================================================================== onde paramos
KINDS = {"anime", "serie", "filme", "jogo", "outro"}
STATUSES = {"watching", "paused", "planned", "done"}


async def shows_out(server_id: int) -> list[dict]:
    rows = await pool().fetch("SELECT * FROM shows WHERE server_id = $1 ORDER BY updated_at DESC", server_id)
    return [
        {
            "id": sid(r["id"]),
            "title": r["title"],
            "kind": r["kind"],
            "status": r["status"],
            "season": r["season"],
            "episode": r["episode"],
            "total": r["total"],
            "note": r["note"],
            "created_by": sid(r["created_by"]) if r["created_by"] else None,
            "updated_by": sid(r["updated_by"]) if r["updated_by"] else None,
            "updated_at": r["updated_at"].isoformat(),
        }
        for r in rows
    ]


async def announce_shows(server_id: int) -> list[dict]:
    items = await shows_out(server_id)
    await hub.to_server(server_id, "shows", {"server_id": sid(server_id), "items": items})
    return items


class ShowIn(BaseModel):
    title: str | None = None
    kind: str | None = None
    status: str | None = None
    season: int | None = None
    episode: int | None = None
    total: int | None = None
    note: str | None = None
    clear_total: bool = False
    clear_season: bool = False


def _clean_show(body: ShowIn) -> dict[str, Any]:
    out: dict[str, Any] = {}
    if body.title is not None:
        title = body.title.strip()[:120]
        if not title:
            raise err(400, "Dá um nome para o que vocês estão assistindo.")
        out["title"] = title
    if body.kind is not None:
        if body.kind not in KINDS:
            raise err(400, "Tipo inválido.")
        out["kind"] = body.kind
    if body.status is not None:
        if body.status not in STATUSES:
            raise err(400, "Situação inválida.")
        out["status"] = body.status
    for key in ("season", "episode", "total"):
        val = getattr(body, key)
        if val is not None:
            if not 0 <= val <= 100_000:
                raise err(400, "Número fora do normal.")
            out[key] = val
    if body.clear_total:
        out["total"] = None
    if body.clear_season:
        out["season"] = None
    if body.note is not None:
        out["note"] = body.note.strip()[:300]
    return out


@router.get("/servers/{server_id}/shows")
async def list_shows(server_id: str, me: Auth = CurrentUser) -> list[dict]:
    s = parse_id(server_id)
    await require_member(s, me.id)
    return await shows_out(s)


@router.post("/servers/{server_id}/shows")
async def add_show(server_id: str, body: ShowIn, me: Auth = CurrentUser) -> list[dict]:
    s = parse_id(server_id)
    await require_member(s, me.id)
    data = _clean_show(body)
    if "title" not in data:
        raise err(400, "Dá um nome para o que vocês estão assistindo.")
    if await pool().fetchval("SELECT count(*) FROM shows WHERE server_id = $1", s) >= 200:
        raise err(400, "A lista já está cheia (200). Apague o que já acabou.")
    data.setdefault("episode", 0)
    cols = ["id", "server_id", "created_by", "updated_by", *data.keys()]
    vals = [new_id(), s, me.id, me.id, *data.values()]
    await pool().execute(
        f"INSERT INTO shows ({', '.join(cols)}) VALUES ({', '.join(f'${i + 1}' for i in range(len(vals)))})", *vals
    )
    return await announce_shows(s)


async def _show(show_id: int, user_id: int) -> Any:
    row = await pool().fetchrow("SELECT id, server_id FROM shows WHERE id = $1", show_id)
    if not row or not await role_in(row["server_id"], user_id):
        raise err(404, "Não achei isso na lista.")
    return row


@router.patch("/shows/{show_id}")
async def update_show(show_id: str, body: ShowIn, me: Auth = CurrentUser) -> list[dict]:
    row = await _show(parse_id(show_id), me.id)
    data = _clean_show(body)
    if data:
        sets = ", ".join(f"{k} = ${i + 2}" for i, k in enumerate(data))
        await pool().execute(
            f"UPDATE shows SET {sets}, updated_by = ${len(data) + 2}, updated_at = now() WHERE id = $1",
            row["id"], *data.values(), me.id,
        )
    return await announce_shows(row["server_id"])


@router.delete("/shows/{show_id}")
async def delete_show(show_id: str, me: Auth = CurrentUser) -> list[dict]:
    row = await _show(parse_id(show_id), me.id)
    await pool().execute("DELETE FROM shows WHERE id = $1", row["id"])
    return await announce_shows(row["server_id"])
