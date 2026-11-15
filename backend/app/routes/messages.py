"""Mensagens: chat de texto em canais e conversas diretas."""

from __future__ import annotations

import asyncio
import json
from typing import Any

from fastapi import APIRouter
from pydantic import BaseModel

from ..core import Auth, CurrentUser, err, file_url, new_id, parse_id, pool, sid, user_out
from ..realtime import can_access_channel, hub

router = APIRouter()

MAX_LEN = 4000
MAX_ATTACHMENTS = 10


SELECT_MESSAGES = """
    SELECT m.id, m.channel_id, m.content, m.kind, m.attachments, m.reply_to, m.edited_at, m.created_at, m.webhook_id, m.author_name,
           u.id AS u_id, u.username AS u_username, u.display_name AS u_display_name, u.bio AS u_bio,
           u.accent AS u_accent, u.status AS u_status, u.custom_status AS u_custom_status, u.pronouns AS u_pronouns,
           u.created_at AS u_created_at, u.avatar_id AS u_avatar_id, av.animated AS u_avatar_animated,
           u.banner_id AS u_banner_id, bn.animated AS u_banner_animated, u.join_sound_id AS u_join_sound_id,
           u.name_color AS u_name_color, u.theme AS u_theme, u.badges AS u_badges
    FROM messages m
    LEFT JOIN users u ON u.id = m.author_id
    LEFT JOIN files av ON av.id = u.avatar_id
    LEFT JOIN files bn ON bn.id = u.banner_id
"""


async def messages_out(rows: list[Any], viewer: int) -> list[dict]:
    if not rows:
        return []
    ids = [r["id"] for r in rows]
    reacts = await pool().fetch(
        """SELECT message_id, emoji, count(*) AS n, bool_or(user_id = $2) AS me
           FROM reactions WHERE message_id = ANY($1::bigint[]) GROUP BY message_id, emoji ORDER BY min(ctid::text)""",
        ids, viewer,
    )
    by_msg: dict[int, list[dict]] = {}
    for r in reacts:
        by_msg.setdefault(r["message_id"], []).append({"emoji": r["emoji"], "count": r["n"], "me": r["me"]})

    reply_ids = [r["reply_to"] for r in rows if r["reply_to"]]
    replies: dict[int, dict] = {}
    if reply_ids:
        for r in await pool().fetch(
            """SELECT m.id, m.content, m.author_id, u.display_name, m.attachments FROM messages m
               LEFT JOIN users u ON u.id = m.author_id WHERE m.id = ANY($1::bigint[])""",
            reply_ids,
        ):
            atts = json.loads(r["attachments"]) if isinstance(r["attachments"], str) else r["attachments"]
            replies[r["id"]] = {
                "id": sid(r["id"]),
                "author_id": sid(r["author_id"]),
                "author_name": r["display_name"] or "Alguém",
                "content": r["content"][:140],
                "has_attachments": bool(atts),
            }

    out = []
    for r in rows:
        author = None
        if r["webhook_id"] is not None:
            author = bot_author(r["webhook_id"], r["author_name"], r["created_at"])
        elif r["u_id"] is not None:
            u = {k[2:]: v for k, v in dict(r).items() if k.startswith("u_")}
            author = user_out(u, presence=hub.presence(u["id"], u["status"]))
        atts = json.loads(r["attachments"]) if isinstance(r["attachments"], str) else r["attachments"]
        # o endereço público pode mudar (túnel): monta o link de novo a partir do id
        for a in atts or []:
            if a.get("id"):
                a["url"] = file_url(int(a["id"]))
        out.append(
            {
                "id": sid(r["id"]),
                "channel_id": sid(r["channel_id"]),
                "author": author,
                "content": r["content"],
                "kind": r["kind"],
                "attachments": atts,
                "reply_to": replies.get(r["reply_to"]) if r["reply_to"] else None,
                "reply_missing": bool(r["reply_to"] and r["reply_to"] not in replies),
                "reactions": by_msg.get(r["id"], []),
                "edited_at": r["edited_at"].isoformat() if r["edited_at"] else None,
                "created_at": r["created_at"].isoformat(),
            }
        )
    return out


def bot_author(webhook_id: int, name: str, created_at: Any) -> dict:
    """Autor de mensagem de webhook: parece um usuário, com a marca de bot."""
    return {
        "id": sid(webhook_id), "username": "bot", "display_name": name or "Bot", "bio": "", "accent": "#5865f2",
        "pronouns": "", "custom_status": "", "status": "online", "avatar": None, "banner": None, "join_sound": None,
        "name_color": "", "theme": [], "badges": [], "created_at": created_at.isoformat(), "bot": True,
    }


async def post_webhook_message(channel_id: int, webhook_id: int, name: str, content: str) -> dict:
    mid = new_id()
    await pool().execute(
        "INSERT INTO messages (id, channel_id, author_id, content, kind, webhook_id, author_name) VALUES ($1,$2,NULL,$3,'default',$4,$5)",
        mid, channel_id, content, webhook_id, name,
    )
    await pool().execute("UPDATE channels SET last_message_id = $1 WHERE id = $2", mid, channel_id)
    msg = await message_by_id(mid, 0)
    assert msg
    await hub.to_channel(channel_id, "message_create", msg)
    return msg


async def fetch_messages(where: str, *args: Any, viewer: int, limit: int = 50) -> list[dict]:
    rows = await pool().fetch(f"{SELECT_MESSAGES} WHERE {where} ORDER BY m.id DESC LIMIT {int(limit)}", *args)
    return list(reversed(await messages_out(rows, viewer)))


async def message_by_id(mid: int, viewer: int) -> dict | None:
    got = await fetch_messages("m.id = $1", mid, viewer=viewer, limit=1)
    return got[0] if got else None


async def post_message(
    channel_id: int, author_id: int, content: str, *, kind: str = "default", attachments: list | None = None, reply_to: int | None = None
) -> dict:
    mid = new_id()
    await pool().execute(
        "INSERT INTO messages (id, channel_id, author_id, content, kind, attachments, reply_to) VALUES ($1,$2,$3,$4,$5,$6,$7)",
        mid, channel_id, author_id, content, kind, json.dumps(attachments or []), reply_to,
    )
    await pool().execute("UPDATE channels SET last_message_id = $1 WHERE id = $2", mid, channel_id)
    await pool().execute(
        """INSERT INTO read_states (user_id, channel_id, last_read_id) VALUES ($1, $2, $3)
           ON CONFLICT (user_id, channel_id) DO UPDATE SET last_read_id = EXCLUDED.last_read_id""",
        author_id, channel_id, mid,
    )
    msg = await message_by_id(mid, author_id)
    assert msg
    await hub.to_channel(channel_id, "message_create", msg)
    return msg


async def require_channel(user_id: int, channel_id: int) -> dict:
    ch = await can_access_channel(user_id, channel_id)
    if not ch:
        raise err(404, "Canal não encontrado.")
    return ch


@router.get("/channels/{channel_id}/messages")
async def list_messages(channel_id: str, before: str | None = None, limit: int = 50, me: Auth = CurrentUser) -> list[dict]:
    cid = parse_id(channel_id)
    await require_channel(me.id, cid)
    limit = max(1, min(100, limit))
    if before:
        return await fetch_messages("m.channel_id = $1 AND m.id < $2", cid, parse_id(before), viewer=me.id, limit=limit)
    return await fetch_messages("m.channel_id = $1", cid, viewer=me.id, limit=limit)


class MessageIn(BaseModel):
    content: str = ""
    reply_to: str | None = None
    attachment_ids: list[str] = []
    # figurinha da sua coleção
    sticker_id: str | None = None
    # GIF escolhido na busca (só links do GIPHY)
    gif: dict | None = None


@router.post("/channels/{channel_id}/messages")
async def create_message(channel_id: str, body: MessageIn, me: Auth = CurrentUser) -> dict:
    cid = parse_id(channel_id)
    ch = await require_channel(me.id, cid)
    content = body.content.strip()
    if len(content) > MAX_LEN:
        raise err(400, f"Mensagem longa demais (máximo {MAX_LEN} caracteres).")
    attachments: list[dict] = []
    if body.attachment_ids:
        ids = [parse_id(a) for a in body.attachment_ids[:MAX_ATTACHMENTS]]
        rows = await pool().fetch(
            "SELECT id, name, mime, size, width, height, animated FROM files WHERE id = ANY($1::bigint[]) AND owner_id = $2 AND kind = 'attachment'",
            ids, me.id,
        )
        by_id = {r["id"]: r for r in rows}
        for i in ids:
            r = by_id.get(i)
            if r:
                attachments.append(
                    {"id": sid(r["id"]), "url": file_url(r["id"]), "name": r["name"], "mime": r["mime"], "size": r["size"],
                     "width": r["width"], "height": r["height"], "animated": r["animated"]}
                )
    if body.sticker_id:
        r = await pool().fetchrow(
            """SELECT f.id, f.name, f.mime, f.size, f.width, f.height, f.animated FROM stickers s JOIN files f ON f.id = s.file_id
               WHERE s.id = $1 AND s.user_id = $2""",
            parse_id(body.sticker_id), me.id,
        )
        if not r:
            raise err(404, "Figurinha não encontrada.")
        attachments = [
            {"id": sid(r["id"]), "url": file_url(r["id"]), "name": r["name"], "mime": r["mime"], "size": r["size"],
             "width": r["width"], "height": r["height"], "animated": r["animated"], "sticker": True}
        ]
    elif body.gif:
        from .extras2 import GIF_URL  # aqui para não dar ciclo

        url = str(body.gif.get("url") or "")
        if not GIF_URL.match(url):
            raise err(400, "GIF inválido.")
        w, h = body.gif.get("width"), body.gif.get("height")
        attachments = [
            {"url": url, "name": str(body.gif.get("title") or "GIF")[:80], "mime": "image/gif", "size": 0,
             "width": int(w) if isinstance(w, (int, float)) else None, "height": int(h) if isinstance(h, (int, float)) else None,
             "animated": True, "gif": True}
        ]
    if not content and not attachments:
        raise err(400, "Mensagem vazia.")
    reply = None
    if body.reply_to:
        reply = parse_id(body.reply_to)
        if not await pool().fetchval("SELECT 1 FROM messages WHERE id = $1 AND channel_id = $2", reply, cid):
            reply = None
    msg = await post_message(cid, me.id, content, attachments=attachments, reply_to=reply)
    if content.startswith("/") and ch["type"] in ("text", "dm"):
        from .comandos import run_command  # aqui para não dar ciclo

        task = asyncio.create_task(run_command(ch, me.id, content, msg["id"]))
        _command_tasks.add(task)
        task.add_done_callback(_command_tasks.discard)
    return msg


_command_tasks: set[asyncio.Task] = set()


class EditIn(BaseModel):
    content: str


async def _own_message(mid: int, user_id: int) -> Any:
    row = await pool().fetchrow("SELECT id, channel_id, author_id FROM messages WHERE id = $1", mid)
    if not row or not await can_access_channel(user_id, row["channel_id"]):
        raise err(404, "Mensagem não encontrada.")
    return row


@router.patch("/messages/{message_id}")
async def edit_message(message_id: str, body: EditIn, me: Auth = CurrentUser) -> dict:
    mid = parse_id(message_id)
    row = await _own_message(mid, me.id)
    if row["author_id"] != me.id:
        raise err(403, "Você só pode editar as suas mensagens.")
    content = body.content.strip()
    if not content or len(content) > MAX_LEN:
        raise err(400, "Mensagem vazia ou longa demais.")
    await pool().execute("UPDATE messages SET content = $1, edited_at = now() WHERE id = $2", content, mid)
    msg = await message_by_id(mid, me.id)
    await hub.to_channel(row["channel_id"], "message_update", msg)
    return msg  # type: ignore[return-value]


@router.delete("/messages/{message_id}")
async def delete_message(message_id: str, me: Auth = CurrentUser) -> dict:
    mid = parse_id(message_id)
    row = await _own_message(mid, me.id)
    if row["author_id"] != me.id:
        server_id = await pool().fetchval("SELECT server_id FROM channels WHERE id = $1", row["channel_id"])
        role = await pool().fetchval("SELECT role FROM members WHERE server_id = $1 AND user_id = $2", server_id, me.id) if server_id else None
        if role not in ("admin", "owner"):
            raise err(403, "Você só pode apagar as suas mensagens.")
    await pool().execute("DELETE FROM messages WHERE id = $1", mid)
    await hub.to_channel(row["channel_id"], "message_delete", {"id": sid(mid), "channel_id": sid(row["channel_id"])})
    return {"ok": True}


async def _reaction_event(mid: int, channel_id: int) -> None:
    rows = await pool().fetch(
        "SELECT emoji, user_id FROM reactions WHERE message_id = $1 ORDER BY ctid", mid
    )
    grouped: dict[str, list[str]] = {}
    for r in rows:
        grouped.setdefault(r["emoji"], []).append(sid(r["user_id"]))  # type: ignore[arg-type]
    await hub.to_channel(
        channel_id,
        "reactions",
        {"message_id": sid(mid), "channel_id": sid(channel_id), "reactions": [{"emoji": e, "users": u} for e, u in grouped.items()]},
    )


@router.put("/messages/{message_id}/reactions/{emoji}")
async def add_reaction(message_id: str, emoji: str, me: Auth = CurrentUser) -> dict:
    mid = parse_id(message_id)
    row = await _own_message(mid, me.id)
    emoji = emoji.strip()[:64]
    if not emoji:
        raise err(400, "Emoji inválido.")
    await pool().execute("INSERT INTO reactions (message_id, user_id, emoji) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING", mid, me.id, emoji)
    await _reaction_event(mid, row["channel_id"])
    from .extras import check_hall  # importado aqui para não dar ciclo

    await check_hall(mid, row["channel_id"])
    return {"ok": True}


@router.delete("/messages/{message_id}/reactions/{emoji}")
async def remove_reaction(message_id: str, emoji: str, me: Auth = CurrentUser) -> dict:
    mid = parse_id(message_id)
    row = await _own_message(mid, me.id)
    await pool().execute("DELETE FROM reactions WHERE message_id = $1 AND user_id = $2 AND emoji = $3", mid, me.id, emoji)
    await _reaction_event(mid, row["channel_id"])
    return {"ok": True}


class ReadIn(BaseModel):
    message_id: str


@router.post("/channels/{channel_id}/read")
async def mark_read(channel_id: str, body: ReadIn, me: Auth = CurrentUser) -> dict:
    cid = parse_id(channel_id)
    await require_channel(me.id, cid)
    await pool().execute(
        """INSERT INTO read_states (user_id, channel_id, last_read_id) VALUES ($1, $2, $3)
           ON CONFLICT (user_id, channel_id) DO UPDATE SET last_read_id = GREATEST(read_states.last_read_id, EXCLUDED.last_read_id)""",
        me.id, cid, parse_id(body.message_id),
    )
    return {"ok": True}
