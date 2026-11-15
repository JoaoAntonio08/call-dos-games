"""Moderação de voz (mutar/ensurdecer para todos, volume para todos, tirar e mover da call) e o botão de hype."""

from __future__ import annotations

import time
from typing import Any

import httpx
import jwt
from fastapi import APIRouter
from pydantic import BaseModel

from ..core import Auth, CurrentUser, err, fetch_user, parse_id, pool, settings, sid, user_out
from ..realtime import can_access_channel, hub
from .servers import require_admin, require_member

router = APIRouter()


# ------------------------------------------------------------------ LiveKit (API de servidor)
def room_name(channel_id: int) -> str:
    return f"cdg-{channel_id}"


def _admin_token(room: str) -> str:
    now = int(time.time())
    claims = {"iss": settings.livekit_key, "nbf": now - 10, "exp": now + 60, "video": {"roomAdmin": True, "room": room}}
    return jwt.encode(claims, settings.livekit_secret, algorithm="HS256")


async def livekit(method: str, room: str, body: dict[str, Any]) -> dict | None:
    """Chama o RoomService do LiveKit. Falha (sala vazia, LiveKit fora) não derruba a ação: o app também aplica."""
    if not (settings.livekit_url and settings.livekit_key and settings.livekit_secret):
        return None
    base = settings.livekit_url.replace("wss://", "https://").replace("ws://", "http://").rstrip("/")
    try:
        async with httpx.AsyncClient(timeout=6) as c:
            r = await c.post(
                f"{base}/twirp/livekit.RoomService/{method}",
                json={"room": room, **body},
                headers={"Authorization": f"Bearer {_admin_token(room)}"},
            )
        return r.json() if r.status_code == 200 else None
    except Exception:
        return None


def publish_sources(mute: bool) -> list[str] | None:
    """Fontes que a pessoa pode transmitir. None = todas."""
    return ["camera", "screen_share", "screen_share_audio"] if mute else None


async def mods_of(server_id: int | None, user_id: int) -> dict[str, Any]:
    if server_id is None:
        return {"mute": False, "deaf": False, "gain": 1.0}
    row = await pool().fetchrow("SELECT mute, deaf, gain FROM voice_mods WHERE server_id = $1 AND user_id = $2", server_id, user_id)
    return {"mute": row["mute"], "deaf": row["deaf"], "gain": float(row["gain"])} if row else {"mute": False, "deaf": False, "gain": 1.0}


async def apply_permissions(channel_id: int, user_id: int, mods: dict[str, Any]) -> None:
    perm: dict[str, Any] = {"can_subscribe": not mods["deaf"], "can_publish": True, "can_publish_data": True}
    src = publish_sources(mods["mute"])
    perm["can_publish_sources"] = [s.upper() for s in src] if src else []
    await livekit("UpdateParticipant", room_name(channel_id), {"identity": str(user_id), "permission": perm})


# ------------------------------------------------------------------ quem pode mexer em quem
async def _server_voice_target(server_id: int, user_id: int, me: int) -> int | None:
    """Confere que eu sou admin e o alvo é do servidor. Devolve o canal de voz do servidor onde o alvo está (ou None)."""
    await require_admin(server_id, me)
    if not await pool().fetchval("SELECT 1 FROM members WHERE server_id = $1 AND user_id = $2", server_id, user_id):
        raise err(404, "Essa pessoa não está no servidor.")
    cid = hub.user_voice.get(user_id)
    if cid is None:
        return None
    srv = await pool().fetchval("SELECT server_id FROM channels WHERE id = $1", cid)
    return cid if srv == server_id else None


class ModsIn(BaseModel):
    mute: bool | None = None
    deaf: bool | None = None
    gain: float | None = None


@router.patch("/servers/{server_id}/voice/{user_id}")
async def set_voice_mods(server_id: str, user_id: str, body: ModsIn, me: Auth = CurrentUser) -> dict:
    """Admin: mutar/ensurdecer para todos e volume da pessoa para todos (vale em todas as calls do servidor)."""
    s, target = parse_id(server_id), parse_id(user_id)
    cid = await _server_voice_target(s, target, me.id)
    mods = await mods_of(s, target)
    if body.mute is not None:
        mods["mute"] = body.mute
    if body.deaf is not None:
        mods["deaf"] = body.deaf
    if body.gain is not None:
        mods["gain"] = max(0.0, min(1.0, round(body.gain, 2)))
    await pool().execute(
        """INSERT INTO voice_mods (server_id, user_id, mute, deaf, gain) VALUES ($1,$2,$3,$4,$5)
           ON CONFLICT (server_id, user_id) DO UPDATE SET mute = EXCLUDED.mute, deaf = EXCLUDED.deaf, gain = EXCLUDED.gain""",
        s, target, mods["mute"], mods["deaf"], mods["gain"],
    )
    if cid is not None:
        await apply_permissions(cid, target, mods)
        await hub.refresh_mods(cid, target, mods)
    return {"user_id": sid(target), **mods}


@router.post("/servers/{server_id}/voice/{user_id}/disconnect")
async def disconnect_member(server_id: str, user_id: str, me: Auth = CurrentUser) -> dict:
    s, target = parse_id(server_id), parse_id(user_id)
    cid = await _server_voice_target(s, target, me.id)
    if cid is None:
        raise err(404, "Essa pessoa não está em nenhuma call do servidor.")
    me_row = await fetch_user(me.id)
    await hub.send([target], "voice_kick", {"channel_id": sid(cid), "by": me_row["display_name"] if me_row else "Um admin"})
    await livekit("RemoveParticipant", room_name(cid), {"identity": str(target)})
    await hub.set_voice(target, None, {})
    return {"ok": True}


class MoveIn(BaseModel):
    channel_id: str


@router.post("/servers/{server_id}/voice/{user_id}/move")
async def move_member(server_id: str, user_id: str, body: MoveIn, me: Auth = CurrentUser) -> dict:
    s, target = parse_id(server_id), parse_id(user_id)
    to = parse_id(body.channel_id)
    cid = await _server_voice_target(s, target, me.id)
    if cid is None:
        raise err(404, "Essa pessoa não está em nenhuma call do servidor.")
    ch = await pool().fetchrow("SELECT server_id, type, name FROM channels WHERE id = $1", to)
    if not ch or ch["server_id"] != s or ch["type"] != "voice":
        raise err(404, "Canal de voz não encontrado.")
    if to == cid:
        return {"ok": True}
    me_row = await fetch_user(me.id)
    # o app da pessoa troca de sala sozinho ao receber isto
    await hub.send([target], "voice_move", {"channel_id": sid(to), "channel_name": ch["name"], "by": me_row["display_name"] if me_row else "Um admin"})
    return {"ok": True}


# ------------------------------------------------------------------ hype: chama todo mundo para a call
_last_hype: dict[int, float] = {}


@router.post("/channels/{channel_id}/hype")
async def hype(channel_id: str, me: Auth = CurrentUser) -> dict:
    cid = parse_id(channel_id)
    ch = await can_access_channel(me.id, cid)
    if not ch or ch["type"] != "voice" or ch["server_id"] is None:
        raise err(404, "Canal de voz não encontrado.")
    s = ch["server_id"]
    await require_member(s, me.id)
    cooldown = await pool().fetchval("SELECT hype_cooldown FROM servers WHERE id = $1", s)
    if not cooldown:
        raise err(403, "O hype está desligado neste servidor.")
    now = time.monotonic()
    wait = cooldown - (now - _last_hype.get(s, -1e9))
    if wait > 0:
        raise err(429, f"Alguém acabou de chamar a turma. Dá para chamar de novo em {int(wait) + 1} s.")
    _last_hype[s] = now
    server = await pool().fetchrow("SELECT name FROM servers WHERE id = $1", s)
    user = await fetch_user(me.id)
    assert user and server
    in_call = len(hub.voice.get(cid, {}))
    data = {
        "server_id": sid(s),
        "server_name": server["name"],
        "channel_id": sid(cid),
        "channel_name": ch["name"],
        "in_call": in_call,
        "by": user_out(user),
    }
    rows = await pool().fetch("SELECT user_id FROM members WHERE server_id = $1 AND user_id <> $2", s, me.id)
    await hub.send((r["user_id"] for r in rows), "hype", data)
    # fica registrado no chat do servidor, para quem estava fora ver depois
    text = await pool().fetchval(
        "SELECT id FROM channels WHERE server_id = $1 AND type = 'text' ORDER BY position, id LIMIT 1", s
    )
    if text:
        from .messages import post_message  # aqui para não dar ciclo

        await post_message(text, me.id, sid(cid), kind="hype")  # o conteúdo é o id do canal de voz
    return {"ok": True, "notified": len(rows)}
