"""Gateway em tempo real (WebSocket): presença, mensagens novas, quem está em cada canal de voz.

Tudo em memória, num processo só. Para um grupo de amigos isso sobra; rode o uvicorn com 1 worker.
"""

from __future__ import annotations

import asyncio
import json
import time
from typing import Any, Iterable

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from .core import parse_id, pool, sid, user_from_token

router = APIRouter()


class Hub:
    def __init__(self) -> None:
        self.sockets: dict[int, set[WebSocket]] = {}
        # canal de voz -> {usuário -> estado}
        self.voice: dict[int, dict[int, dict[str, Any]]] = {}
        # o que o "DJ" está tocando em cada call (aparece como um participante a mais)
        self.music: dict[int, dict[str, Any]] = {}
        self.user_voice: dict[int, int] = {}
        # o que cada um está jogando agora: a Steam tem preferência, depois o jogo que o app de Windows achou
        self.games: dict[int, dict[str, Any]] = {}
        self.steam_games: dict[int, dict[str, Any]] = {}
        self.app_games: dict[int, dict[str, Any]] = {}

    async def update_game(self, user_id: int) -> None:
        """Recalcula o "jogando agora" da pessoa e avisa quem conhece ela, se mudou."""
        g = self.steam_games.get(user_id) or self.app_games.get(user_id)
        if g == self.games.get(user_id):
            return
        if g:
            self.games[user_id] = g
        else:
            self.games.pop(user_id, None)
        await self.to_audience(user_id, "game", {"user_id": sid(user_id), "game": g})

    # ---------------- presença
    def online(self, user_id: int) -> bool:
        return bool(self.sockets.get(user_id))

    def presence(self, user_id: int, chosen: str) -> str:
        if not self.online(user_id) or chosen == "invisible":
            return "offline"
        return chosen

    # ---------------- envio
    async def send(self, user_ids: Iterable[int], event: str, data: Any) -> None:
        msg = json.dumps({"t": event, "d": data}, default=str)
        dead: list[tuple[int, WebSocket]] = []
        for uid in set(user_ids):
            for ws in list(self.sockets.get(uid, ())):
                try:
                    await ws.send_text(msg)
                except Exception:
                    dead.append((uid, ws))
        for uid, ws in dead:
            self.sockets.get(uid, set()).discard(ws)

    async def to_server(self, server_id: int, event: str, data: Any) -> None:
        rows = await pool().fetch("SELECT user_id FROM members WHERE server_id = $1", server_id)
        await self.send((r["user_id"] for r in rows), event, data)

    async def to_channel(self, channel_id: int, event: str, data: Any) -> None:
        row = await pool().fetchrow("SELECT server_id FROM channels WHERE id = $1", channel_id)
        if not row:
            return
        if row["server_id"] is not None:
            from .perms import channel_viewers  # noqa: PLC0415

            viewers = await channel_viewers(channel_id)
            if viewers is None:
                await self.to_server(row["server_id"], event, data)
            else:
                await self.send(viewers, event, data)
        else:
            rows = await pool().fetch("SELECT user_id FROM dm_participants WHERE channel_id = $1", channel_id)
            await self.send((r["user_id"] for r in rows), event, data)

    async def audience_of(self, user_id: int) -> set[int]:
        """Quem enxerga esse usuário: colegas de servidor, amigos e conversas diretas."""
        rows = await pool().fetch(
            """
            SELECT m2.user_id AS id FROM members m1 JOIN members m2 ON m2.server_id = m1.server_id WHERE m1.user_id = $1
            UNION SELECT addressee_id FROM friendships WHERE requester_id = $1
            UNION SELECT requester_id FROM friendships WHERE addressee_id = $1
            UNION SELECT d2.user_id FROM dm_participants d1 JOIN dm_participants d2 ON d2.channel_id = d1.channel_id WHERE d1.user_id = $1
            """,
            user_id,
        )
        out = {r["id"] for r in rows}
        out.add(user_id)
        return out

    async def to_audience(self, user_id: int, event: str, data: Any) -> None:
        await self.send(await self.audience_of(user_id), event, data)

    async def broadcast_presence(self, user_id: int) -> None:
        row = await pool().fetchrow("SELECT status, custom_status FROM users WHERE id = $1", user_id)
        if not row:
            return
        await self.to_audience(
            user_id,
            "presence",
            {"user_id": sid(user_id), "status": self.presence(user_id, row["status"]), "custom_status": row["custom_status"]},
        )

    # ---------------- voz
    def voice_snapshot(self, channel_ids: Iterable[int] | None = None) -> dict[str, list[dict[str, Any]]]:
        ids = self.voice.keys() if channel_ids is None else channel_ids
        return {
            str(cid): [{"user_id": sid(uid), **st} for uid, st in self.voice.get(cid, {}).items()]
            for cid in ids
            if self.voice.get(cid)
        }

    def music_snapshot(self, channel_ids: Iterable[int] | None = None) -> dict[str, dict[str, Any]]:
        ids = self.music.keys() if channel_ids is None else channel_ids
        return {str(cid): self.music[cid] for cid in ids if cid in self.music}

    async def set_music(self, channel_id: int, music: dict[str, Any] | None) -> None:
        if music is None:
            if self.music.pop(channel_id, None) is None:
                return
        else:
            self.music[channel_id] = music
        await self.to_channel(channel_id, "music_state", {"channel_id": sid(channel_id), "music": music})

    async def set_voice(self, user_id: int, channel_id: int | None, state: dict[str, Any]) -> None:
        old = self.user_voice.get(user_id)
        if old is not None and old != channel_id:
            self.voice.get(old, {}).pop(user_id, None)
            if not self.voice.get(old):
                self.voice.pop(old, None)
                await self.set_music(old, None)  # call vazia: o DJ sai junto
            await self._announce_voice(old)
            self.user_voice.pop(user_id, None)
        if channel_id is not None:
            mods = await self._mods(channel_id, user_id)
            prev = self.voice.setdefault(channel_id, {}).get(user_id, {})
            self.voice[channel_id][user_id] = {
                # mutado/ensurdecido por um admin e volume para todos
                "smute": mods["mute"],
                "sdeaf": mods["deaf"],
                "gain": mods["gain"],
                # sem poder transmitir tela/câmera (passou do limite ou foi restringido)
                "noshare": mods.get("noshare", False),
                "mic": bool(state.get("mic", True)) and not mods["mute"],
                "deaf": bool(state.get("deaf", False)) or mods["deaf"],
                "video": bool(state.get("video", False)),
                "stream": bool(state.get("stream", False)),
                "since": prev.get("since", int(time.time() * 1000)),
            }
            self.user_voice[user_id] = channel_id
            await self._announce_voice(channel_id)

    async def _mods(self, channel_id: int, user_id: int) -> dict[str, Any]:
        from .routes.voz import mods_of  # noqa: PLC0415

        return await mods_of(await pool().fetchval("SELECT server_id FROM channels WHERE id = $1", channel_id), user_id)

    async def refresh_mods(self, channel_id: int, user_id: int, mods: dict[str, Any]) -> None:
        st = self.voice.get(channel_id, {}).get(user_id)
        if st is None:
            return
        st.update({"smute": mods["mute"], "sdeaf": mods["deaf"], "gain": mods["gain"], "noshare": mods.get("noshare", False)})
        if mods.get("noshare"):
            st["video"] = False
            st["stream"] = False
        if mods["mute"]:
            st["mic"] = False
        if mods["deaf"]:
            st["deaf"] = True
        await self._announce_voice(channel_id)

    async def _announce_voice(self, channel_id: int) -> None:
        members = [{"user_id": sid(uid), **st} for uid, st in self.voice.get(channel_id, {}).items()]
        await self.to_channel(channel_id, "voice_state", {"channel_id": sid(channel_id), "members": members})


hub = Hub()


async def can_access_channel(user_id: int, channel_id: int) -> dict | None:
    row = await pool().fetchrow(
        """
        SELECT c.id, c.server_id, c.type, c.name, c.send_roles,
               (c.server_id IS NULL OR cardinality(c.send_roles) = 0
                OR EXISTS (SELECT 1 FROM members m WHERE m.server_id = c.server_id AND m.user_id = $2 AND m.role IN ('owner', 'admin'))
                OR EXISTS (SELECT 1 FROM member_roles mr WHERE mr.server_id = c.server_id AND mr.user_id = $2 AND mr.role_id = ANY(c.send_roles))
               ) AS can_send
        FROM channels c
        WHERE c.id = $1 AND (
            (c.server_id IS NOT NULL AND EXISTS (SELECT 1 FROM members m WHERE m.server_id = c.server_id AND m.user_id = $2)
             AND (cardinality(c.view_roles) = 0
                  OR EXISTS (SELECT 1 FROM members m WHERE m.server_id = c.server_id AND m.user_id = $2 AND m.role IN ('owner', 'admin'))
                  OR EXISTS (SELECT 1 FROM member_roles mr WHERE mr.server_id = c.server_id AND mr.user_id = $2 AND mr.role_id = ANY(c.view_roles))))
            OR (c.server_id IS NULL AND EXISTS (SELECT 1 FROM dm_participants d WHERE d.channel_id = c.id AND d.user_id = $2))
        )
        """,
        channel_id,
        user_id,
    )
    return dict(row) if row else None


@router.websocket("/gateway")
async def gateway(ws: WebSocket) -> None:
    await ws.accept()
    # 1ª mensagem precisa ser {"op": "auth", "token": "..."} (o token não vai na URL para não cair em log)
    try:
        first = json.loads(await asyncio.wait_for(ws.receive_text(), timeout=10))
        found = await user_from_token(str(first.get("token", ""))) if first.get("op") == "auth" else None
    except Exception:
        found = None
    if not found:
        await ws.close(code=4001, reason="auth")
        return
    user_id, _ = found
    was_online = hub.online(user_id)
    hub.sockets.setdefault(user_id, set()).add(ws)
    # o hello já leva quem está em call: o que mudou entre o /bootstrap e a conexão não se perde
    rows = await pool().fetch(
        """SELECT c.id FROM channels c JOIN members m ON m.server_id = c.server_id
           WHERE m.user_id = $1 AND c.type = 'voice'
           UNION SELECT channel_id FROM dm_participants WHERE user_id = $1""",
        user_id,
    )
    voice = hub.voice_snapshot([int(r["id"]) for r in rows])
    games = {sid(uid): g for uid, g in hub.games.items()}
    music = hub.music_snapshot([int(r["id"]) for r in rows])
    await ws.send_text(json.dumps({"t": "hello", "d": {"user_id": sid(user_id), "voice": voice, "music": music, "games": games}}))
    if not was_online:
        await hub.broadcast_presence(user_id)

    try:
        while True:
            raw_text = await ws.receive_text()
            try:
                await handle(user_id, ws, json.loads(raw_text))
            except WebSocketDisconnect:
                raise
            except Exception:
                continue  # mensagem ruim não derruba a conexão
    except (WebSocketDisconnect, RuntimeError):
        pass
    finally:
        hub.sockets.get(user_id, set()).discard(ws)
        if not hub.online(user_id):
            hub.sockets.pop(user_id, None)
            await hub.set_voice(user_id, None, {})
            await hub.broadcast_presence(user_id)
            # o jogo do app de Windows só vale enquanto o app está conectado
            if hub.app_games.pop(user_id, None):
                await hub.update_game(user_id)


async def handle(user_id: int, ws: WebSocket, msg: dict) -> None:
    op = msg.get("op")
    if op == "ping":
        await ws.send_text('{"t":"pong","d":null}')
    elif op == "typing":
        cid = parse_id(msg.get("channel_id"))
        if await can_access_channel(user_id, cid):
            await hub.to_channel(cid, "typing", {"channel_id": sid(cid), "user_id": sid(user_id)})
    elif op == "voice":
        raw = msg.get("channel_id")
        if raw is None:
            await hub.set_voice(user_id, None, {})
        else:
            cid = parse_id(raw)
            ch = await can_access_channel(user_id, cid)
            if ch and ch["type"] in ("voice", "dm"):
                await hub.set_voice(user_id, cid, msg)
