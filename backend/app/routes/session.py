"""Carga inicial do app e token de voz do LiveKit."""

from __future__ import annotations

import json
import time

import jwt
from fastapi import APIRouter
from pydantic import BaseModel

from ..core import Auth, CurrentUser, err, fetch_user, parse_id, pool, settings, sid, user_out
from ..realtime import can_access_channel, hub
from .servers import server_out
from .users import friends_of, list_dms, me_out

router = APIRouter()


@router.get("/bootstrap")
async def bootstrap(me: Auth = CurrentUser) -> dict:
    server_ids = [r["server_id"] for r in await pool().fetch("SELECT server_id FROM members WHERE user_id = $1 ORDER BY joined_at", me.id)]
    servers = [await server_out(s) for s in server_ids]
    dms = await list_dms(me.id)
    reads = await pool().fetch("SELECT channel_id, last_read_id FROM read_states WHERE user_id = $1", me.id)
    visible: list[int] = [int(c["id"]) for s in servers for c in s["channels"]] + [int(d["id"]) for d in dms]
    return {
        "me": await me_out(me.id),
        "servers": servers,
        "dms": dms,
        "friends": await friends_of(me.id),
        "read_states": {sid(r["channel_id"]): sid(r["last_read_id"]) for r in reads},
        "voice": hub.voice_snapshot(visible),
        "livekit": bool(settings.livekit_url and settings.livekit_key and settings.livekit_secret),
        # franquia de GB só existe no LiveKit Cloud; no servidor próprio o aviso muda
        "livekit_cloud": "livekit.cloud" in settings.livekit_url,
    }


class VoiceIn(BaseModel):
    channel_id: str


@router.post("/voice/token")
async def voice_token(body: VoiceIn, me: Auth = CurrentUser) -> dict:
    if not (settings.livekit_url and settings.livekit_key and settings.livekit_secret):
        raise err(503, "O servidor de voz não está configurado (LIVEKIT_URL, LIVEKIT_API_KEY e LIVEKIT_API_SECRET).")
    cid = parse_id(body.channel_id)
    ch = await can_access_channel(me.id, cid)
    if not ch or ch["type"] not in ("voice", "dm"):
        raise err(404, "Canal de voz não encontrado.")
    user = await fetch_user(me.id)
    assert user
    profile = user_out(user)
    from .voz import mods_of, publish_sources  # aqui para não dar ciclo

    mods = await mods_of(ch["server_id"], me.id)
    grant: dict = {
        "room": f"cdg-{cid}",
        "roomJoin": True,
        "canPublish": True,
        "canSubscribe": not mods["deaf"],
        "canPublishData": True,
    }
    if (src := publish_sources(mods["mute"])) is not None:
        grant["canPublishSources"] = src
    now = int(time.time())
    claims = {
        "iss": settings.livekit_key,
        "sub": str(me.id),
        "name": profile["display_name"],
        "nbf": now - 10,
        "exp": now + 12 * 3600,
        # o resto da call lê foto, cor e som de entrada daqui
        "metadata": json.dumps(
            {
                "avatar": profile["avatar"],
                "accent": profile["accent"],
                "username": profile["username"],
                "join_sound": profile["join_sound"],
            }
        ),
        "video": grant,
    }
    token = jwt.encode(claims, settings.livekit_secret, algorithm="HS256")
    return {"token": token, "url": settings.livekit_url, "identity": str(me.id)}
