"""Música pelo chat: /tocar <nome ou link>, /fila e /pular.

A música entra na fila da call em que a pessoa está (a mesma fila do "YouTube junto"). Quem tocar, todo mundo
da call ouve, cada um no próprio volume. Só quem pôs a música (ou admin / cargo com DJ) pausa e pula;
os outros votam para pular.
"""

from __future__ import annotations

import os
import httpx
from fastapi import APIRouter
from pydantic import BaseModel

from ..core import Auth, CurrentUser, fetch_user, new_id, parse_id, pool, settings, sid
from ..perms import Member
from ..realtime import hub
from .extras import announce_queue, parse_youtube, youtube_info

YOUTUBE_BASE = os.environ.get("YOUTUBE_API_BASE", "https://www.googleapis.com").rstrip("/")


async def youtube_search(q: str) -> tuple[str, str, str] | None:
    """(video_id, título, canal) do primeiro resultado. Precisa de YOUTUBE_API_KEY."""
    if not settings.youtube_key:
        return None
    try:
        async with httpx.AsyncClient(timeout=6) as c:
            r = await c.get(
                YOUTUBE_BASE + "/youtube/v3/search",
                params={"part": "snippet", "type": "video", "maxResults": "1", "videoEmbeddable": "true", "regionCode": "BR", "q": q, "key": settings.youtube_key},
            )
        if r.status_code != 200:
            return None
        items = r.json().get("items") or []
        if not items:
            return None
        it = items[0]
        vid = (it.get("id") or {}).get("videoId") or ""
        sn = it.get("snippet") or {}
        if len(vid) != 11:
            return None
        import html

        return vid, html.unescape(str(sn.get("title", "")))[:200], html.unescape(str(sn.get("channelTitle", "")))[:100]
    except Exception:
        return None


router = APIRouter()
_titles: dict[str, tuple[str, str]] = {}


class NowPlayingIn(BaseModel):
    channel_id: str
    video_id: str | None = None
    owner_id: str | None = None
    playing: bool = True


@router.post("/voice/music")
async def now_playing(body: NowPlayingIn, me: Auth = CurrentUser) -> dict:
    """O app de quem está controlando o vídeo avisa o que está tocando: o "DJ" aparece na call para todo mundo."""
    cid = parse_id(body.channel_id)
    if hub.user_voice.get(me.id) != cid:
        return {"ok": False}
    if not body.video_id:
        await hub.set_music(cid, None)
        return {"ok": True}
    vid = body.video_id[:11]
    cur = hub.music.get(cid)
    if cur and cur["video_id"] == vid and cur["playing"] == body.playing:
        return {"ok": True}
    if vid not in _titles:
        if len(_titles) > 2000:
            _titles.clear()
        _titles[vid] = await youtube_info(vid)
    title, author = _titles[vid]
    owner = parse_id(body.owner_id) if body.owner_id and body.owner_id.isdigit() else me.id
    who = await fetch_user(owner)
    await hub.set_music(
        cid,
        {
            "video_id": vid,
            "title": title or "Vídeo do YouTube",
            "author": author,
            "owner_id": sid(owner),
            "owner_name": (who or {}).get("display_name") or "Alguém",
            "playing": body.playing,
        },
    )
    return {"ok": True}


async def _call_of(ch: dict, user_id: int) -> int | None:
    """A call onde a pessoa está, se for deste servidor (ou desta conversa)."""
    vc = hub.user_voice.get(user_id)
    if vc is None:
        return None
    srv = await pool().fetchval("SELECT server_id FROM channels WHERE id = $1", vc)
    if ch.get("server_id") is None:
        return vc if vc == ch["id"] else None
    return vc if srv == ch["server_id"] else None


async def music_command(name: str, args: str, ch: dict, user_id: int, who: Member | None) -> str:
    vc = await _call_of(ch, user_id)
    if name == "tocar":
        if not args:
            return "🎵 Use assim: /tocar nome da música (ou um link do YouTube)."
        if vc is None:
            return "🎵 Entre numa call deste servidor primeiro: a música toca para quem está na call com você."
        parsed = parse_youtube(args)
        if parsed:
            vid, start = parsed
            title, author = await youtube_info(vid)
        else:
            if not settings.youtube_key:
                return "🎵 A busca por nome ainda não está ligada neste servidor (falta a chave do YouTube). Mande o link do vídeo: /tocar https://youtu.be/…"
            found = await youtube_search(args)
            if not found:
                return f"🎵 Não achei nada para “{args[:80]}”."
            vid, title, author = found
            start = 0
        if await pool().fetchval("SELECT count(*) FROM queue_items WHERE channel_id = $1", vc) >= 100:
            return "🎵 A fila já tem 100 músicas. Escutem algumas antes."
        if await pool().fetchval("SELECT 1 FROM queue_items WHERE channel_id = $1 AND video_id = $2", vc, vid):
            return f"🎵 **{title or 'Essa música'}** já está na fila."
        item = new_id()
        await pool().execute(
            "INSERT INTO queue_items (id, channel_id, video_id, start_at, title, author, added_by) VALUES ($1,$2,$3,$4,$5,$6,$7)",
            item, vc, vid, start, title, author, user_id,
        )
        await pool().execute("INSERT INTO queue_votes (item_id, user_id) VALUES ($1, $2)", item, user_id)
        items = await announce_queue(vc)
        pos = next((i + 1 for i, x in enumerate(items) if x["id"] == sid(item)), len(items))
        call = await pool().fetchval("SELECT name FROM channels WHERE id = $1", vc) or "call"
        # todo mundo da call vê o pedido chegar
        who = await fetch_user(user_id)
        await hub.send(
            list(hub.voice.get(vc, {}).keys()),
            "music_added",
            {"channel_id": sid(vc), "title": title or "Música", "by": (who or {}).get("display_name") or "Alguém", "position": pos, "user_id": sid(user_id)},
        )
        return f"🎵 **{title or 'Música'}**{f' · {author}' if author else ''} entrou na fila de {call} (posição {pos}). Só você pausa ou pula ela."
    if name == "fila":
        if vc is None:
            return "🎵 Entre numa call para ver a fila dela."
        items = await announce_queue(vc)
        if not items:
            return "🎵 A fila está vazia. Use /tocar nome da música."
        lines = [f"{i + 1}. {x['title']}" for i, x in enumerate(items[:10])]
        more = f"\n…e mais {len(items) - 10}" if len(items) > 10 else ""
        return "🎵 Fila:\n" + "\n".join(lines) + more
    if name == "pular":
        if vc is None:
            return "🎵 Entre na call onde a música está tocando."
        force = bool(who and who.can("dj"))
        await hub.send(list(hub.voice.get(vc, {}).keys()), "music_skip", {"channel_id": sid(vc), "user_id": sid(user_id), "force": force})
        return "⏭️ Pedido de pular enviado. Se a música é sua (ou você é DJ), ela pula; senão, conta como voto."
    return ""

