"""Servidores, canais, membros, convites, soundboard e emojis."""

from __future__ import annotations

import re
import secrets
from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import APIRouter, Form, UploadFile
from pydantic import BaseModel

from ..core import (
    USER_COLUMNS, USER_JOINS, Auth, CurrentUser, err, file_url, media, new_id, parse_id, pool, sid, user_out,
)
from ..conquistas import forget_channels
from ..files import save_upload
from ..perms import PERMS, RANK
from ..realtime import hub

router = APIRouter()

ROLE_RANK = {"member": 0, "admin": 1, "owner": 2}
HEX_RE = re.compile(r"^#[0-9a-fA-F]{6}$")
EMOJI_NAME_RE = re.compile(r"^[a-z0-9_]{2,32}$")


# ------------------------------------------------------------------ ajudantes
async def role_in(server_id: int, user_id: int) -> str | None:
    return await pool().fetchval("SELECT role FROM members WHERE server_id = $1 AND user_id = $2", server_id, user_id)


async def require_member(server_id: int, user_id: int) -> str:
    role = await role_in(server_id, user_id)
    if not role:
        raise err(404, "Servidor não encontrado.")
    return role


async def require_admin(server_id: int, user_id: int) -> str:
    role = await require_member(server_id, user_id)
    if ROLE_RANK[role] < 1:
        raise err(403, "Só admins podem fazer isso.")
    return role


def channel_out(r: Any) -> dict:
    return {
        "id": sid(r["id"]),
        "server_id": sid(r["server_id"]),
        "type": r["type"],
        "name": r["name"],
        "topic": r["topic"],
        "position": r["position"],
        "last_message_id": sid(r["last_message_id"]),
        "view_roles": [sid(x) for x in (r["view_roles"] or [])],
        "send_roles": [sid(x) for x in (r["send_roles"] or [])],
        "user_limit": r.get("user_limit") or 0,
    }


async def member_rows(server_id: int) -> list[dict]:
    rows = await pool().fetch(
        f"""SELECT {USER_COLUMNS}, m.role, m.nickname, m.joined_at,
                   ARRAY(SELECT mr.role_id FROM member_roles mr WHERE mr.server_id = m.server_id AND mr.user_id = m.user_id) AS role_ids
            FROM members m
            JOIN users u ON u.id = m.user_id {USER_JOINS}
            WHERE m.server_id = $1 ORDER BY m.joined_at""",
        server_id,
    )
    return [
        {
            "user": user_out(r, presence=hub.presence(r["id"], r["status"])),
            "role": r["role"],
            "nickname": r["nickname"],
            "roles": [sid(x) for x in (r["role_ids"] or [])],
            "joined_at": r["joined_at"].isoformat(),
        }
        for r in rows
    ]


async def sounds_of(server_id: int) -> list[dict]:
    rows = await pool().fetch(
        "SELECT id, name, emoji, file_id, volume, uploader_id FROM sounds WHERE server_id = $1 ORDER BY created_at", server_id
    )
    return [
        {"id": sid(r["id"]), "name": r["name"], "emoji": r["emoji"], "url": file_url(r["file_id"]), "volume": r["volume"], "uploader_id": sid(r["uploader_id"])}
        for r in rows
    ]


async def emojis_of(server_id: int) -> list[dict]:
    rows = await pool().fetch(
        "SELECT e.id, e.name, e.file_id, f.animated FROM emojis e JOIN files f ON f.id = e.file_id WHERE e.server_id = $1 ORDER BY e.name",
        server_id,
    )
    return [{"id": sid(r["id"]), "name": r["name"], "url": file_url(r["file_id"]), "animated": r["animated"]} for r in rows]


async def roles_of(server_id: int) -> list[dict]:
    rows = await pool().fetch("SELECT * FROM roles WHERE server_id = $1 ORDER BY position, id", server_id)
    return [{"id": sid(r["id"]), "name": r["name"], "color": r["color"], "position": r["position"], "perms": list(r["perms"] or [])} for r in rows]


async def server_full(server_id: int) -> dict:
    """O servidor inteiro, com todos os canais. Antes de mandar para alguém, passe por for_viewer."""
    s = await pool().fetchrow(
        """SELECT s.*, i.animated AS icon_animated, b.animated AS banner_animated FROM servers s
           LEFT JOIN files i ON i.id = s.icon_id LEFT JOIN files b ON b.id = s.banner_id WHERE s.id = $1""",
        server_id,
    )
    if not s:
        raise err(404, "Servidor não encontrado.")
    channels = await pool().fetch("SELECT * FROM channels WHERE server_id = $1 ORDER BY position, id", server_id)
    return {
        "id": sid(s["id"]),
        "name": s["name"],
        "description": s["description"],
        "owner_id": sid(s["owner_id"]),
        "accent": s["accent"],
        "hall_threshold": s["hall_threshold"],
        "hype_cooldown": s["hype_cooldown"],
        "everyone_perms": list(s["everyone_perms"] or []),
        "welcome_lines": list(s["welcome_lines"] or []),
        "icon": media(s["icon_id"], s["icon_animated"]),
        "banner": media(s["banner_id"], s["banner_animated"]),
        "channels": [channel_out(c) for c in channels],
        "roles": await roles_of(server_id),
        "members": await member_rows(server_id),
        "sounds": await sounds_of(server_id),
        "emojis": await emojis_of(server_id),
    }


def for_viewer(full: dict, viewer: int) -> dict:
    """O que essa pessoa enxerga do servidor: some os canais restritos a cargos que ela não tem."""
    me = next((m for m in full["members"] if m["user"]["id"] == sid(viewer)), None)
    role = me["role"] if me else "member"
    mine = set(me["roles"]) if me else set()
    admin = RANK.get(role, 0) >= 1
    if admin:
        perms = list(PERMS)
    else:
        got = set(full["everyone_perms"])
        for r in full["roles"]:
            if r["id"] in mine:
                got |= set(r["perms"])
        perms = [p for p in PERMS if p in got]
    channels = [c for c in full["channels"] if admin or not c["view_roles"] or mine & set(c["view_roles"])]
    return {**full, "channels": channels, "my_perms": perms}


async def server_out(server_id: int, viewer: int) -> dict:
    return for_viewer(await server_full(server_id), viewer)


async def announce_server(server_id: int) -> None:
    full = await server_full(server_id)
    for m in full["members"]:
        uid = int(m["user"]["id"])
        await hub.send([uid], "server_update", for_viewer(full, uid))


# ------------------------------------------------------------------ servidores
class ServerIn(BaseModel):
    name: str
    description: str = ""


@router.post("/servers")
async def create_server(body: ServerIn, me: Auth = CurrentUser) -> dict:
    name = body.name.strip()[:48]
    if not name:
        raise err(400, "Dê um nome para o servidor.")
    server_id = new_id()
    async with pool().acquire() as con, con.transaction():
        await con.execute(
            "INSERT INTO servers (id, name, description, owner_id) VALUES ($1, $2, $3, $4)",
            server_id, name, body.description.strip()[:200], me.id,
        )
        await con.execute("INSERT INTO members (server_id, user_id, role) VALUES ($1, $2, 'owner')", server_id, me.id)
        defaults = [("text", "geral", "Papo de tudo"), ("text", "clipes-e-prints", "Mostre aquela jogada"), ("voice", "Sala de estar", ""), ("voice", "Jogatina", "")]
        for pos, (kind, cname, topic) in enumerate(defaults):
            await con.execute(
                "INSERT INTO channels (id, server_id, type, name, topic, position) VALUES ($1,$2,$3,$4,$5,$6)",
                new_id(), server_id, kind, cname, topic, pos,
            )
    out = await server_out(server_id, me.id)
    await hub.send([me.id], "server_create", out)
    from ..conquistas import server_created

    await server_created(me.id)  # placa Fundador
    return out


@router.get("/servers/{server_id}")
async def get_server(server_id: str, me: Auth = CurrentUser) -> dict:
    s = parse_id(server_id)
    await require_member(s, me.id)
    return await server_out(s, me.id)


class ServerPatch(BaseModel):
    name: str | None = None
    description: str | None = None
    accent: str | None = None
    hall_threshold: int | None = None
    welcome_lines: list[str] | None = None
    hype_cooldown: int | None = None
    everyone_perms: list[str] | None = None


HYPE_CHOICES = {0, 30, 60, 120, 300, 600, 1800}


@router.patch("/servers/{server_id}")
async def update_server(server_id: str, body: ServerPatch, me: Auth = CurrentUser) -> dict:
    s = parse_id(server_id)
    await require_admin(s, me.id)
    if body.name is not None:
        if not body.name.strip():
            raise err(400, "O nome não pode ficar vazio.")
        await pool().execute("UPDATE servers SET name = $1 WHERE id = $2", body.name.strip()[:48], s)
    if body.description is not None:
        await pool().execute("UPDATE servers SET description = $1 WHERE id = $2", body.description.strip()[:200], s)
    if body.accent is not None:
        if not HEX_RE.match(body.accent):
            raise err(400, "Cor inválida.")
        await pool().execute("UPDATE servers SET accent = $1 WHERE id = $2", body.accent.lower(), s)
    if body.hall_threshold is not None:
        if not 1 <= body.hall_threshold <= 50:
            raise err(400, "O Hall precisa de 1 a 50 pessoas.")
        await pool().execute("UPDATE servers SET hall_threshold = $1 WHERE id = $2", body.hall_threshold, s)
    if body.hype_cooldown is not None:
        if body.hype_cooldown not in HYPE_CHOICES:
            raise err(400, "Tempo de hype inválido.")
        await pool().execute("UPDATE servers SET hype_cooldown = $1 WHERE id = $2", body.hype_cooldown, s)
    if body.everyone_perms is not None:
        bad = [p for p in body.everyone_perms if p not in PERMS]
        if bad:
            raise err(400, "Permissão desconhecida.")
        await pool().execute("UPDATE servers SET everyone_perms = $1 WHERE id = $2", sorted(set(body.everyone_perms)), s)
    if body.welcome_lines is not None:
        lines = [x.strip()[:120] for x in body.welcome_lines if x.strip()][:12]
        await pool().execute("UPDATE servers SET welcome_lines = $1 WHERE id = $2", lines, s)
    await announce_server(s)
    return await server_out(s, me.id)


@router.post("/servers/{server_id}/icon")
async def set_icon(server_id: str, file: UploadFile, me: Auth = CurrentUser) -> dict:
    s = parse_id(server_id)
    await require_admin(s, me.id)
    saved = await save_upload(file, "icon", me.id)
    await pool().execute("UPDATE servers SET icon_id = $1 WHERE id = $2", int(saved["id"]), s)
    await announce_server(s)
    return await server_out(s, me.id)


@router.post("/servers/{server_id}/banner")
async def set_server_banner(server_id: str, file: UploadFile, me: Auth = CurrentUser) -> dict:
    s = parse_id(server_id)
    await require_admin(s, me.id)
    saved = await save_upload(file, "banner", me.id)
    await pool().execute("UPDATE servers SET banner_id = $1 WHERE id = $2", int(saved["id"]), s)
    await announce_server(s)
    return await server_out(s, me.id)


@router.delete("/servers/{server_id}")
async def delete_server(server_id: str, me: Auth = CurrentUser) -> dict:
    s = parse_id(server_id)
    if await require_member(s, me.id) != "owner":
        raise err(403, "Só quem criou o servidor pode apagar.")
    members = [r["user_id"] for r in await pool().fetch("SELECT user_id FROM members WHERE server_id = $1", s)]
    from .voz import revoke_server_voice

    for user_id in members:
        await revoke_server_voice(s, user_id)
    await pool().execute("DELETE FROM servers WHERE id = $1", s)
    await hub.send(members, "server_delete", {"id": sid(s)})
    return {"ok": True}


# ------------------------------------------------------------------ membros
@router.delete("/servers/{server_id}/members/{user_id}")
async def remove_member(server_id: str, user_id: str, me: Auth = CurrentUser) -> dict:
    s, target = parse_id(server_id), parse_id(user_id)
    my_role = await require_member(s, me.id)
    target_role = await role_in(s, target)
    if not target_role:
        raise err(404, "Essa pessoa não está no servidor.")
    if target == me.id:
        if my_role == "owner":
            raise err(400, "Quem criou não pode sair. Passe a posse para alguém ou apague o servidor.")
    elif ROLE_RANK[my_role] <= ROLE_RANK[target_role] or ROLE_RANK[my_role] < 1:
        raise err(403, "Você não pode remover essa pessoa.")
    await pool().execute("DELETE FROM members WHERE server_id = $1 AND user_id = $2", s, target)
    from .voz import revoke_server_voice

    await revoke_server_voice(s, target)
    await hub.send([target], "server_delete", {"id": sid(s)})
    await announce_server(s)
    return {"ok": True}


class MemberPatch(BaseModel):
    role: str | None = None
    nickname: str | None = None


@router.patch("/servers/{server_id}/members/{user_id}")
async def update_member(server_id: str, user_id: str, body: MemberPatch, me: Auth = CurrentUser) -> dict:
    s, target = parse_id(server_id), parse_id(user_id)
    my_role = await require_member(s, me.id)
    if body.nickname is not None:
        if target != me.id:
            from ..perms import member as perms_member  # noqa: PLC0415

            who = await perms_member(s, me.id)
            if not who or not who.can("apelidos"):
                raise err(403, "Você só pode trocar o seu apelido.")
            target_role = await role_in(s, target)
            if not target_role:
                raise err(404, "Essa pessoa não está no servidor.")
            if target_role == "owner" and my_role != "owner":
                raise err(403, "Só o dono muda o próprio apelido.")
        await pool().execute("UPDATE members SET nickname = $1 WHERE server_id = $2 AND user_id = $3", body.nickname.strip()[:32], s, target)
    if body.role is not None:
        if my_role != "owner":
            raise err(403, "Só quem criou o servidor muda cargos.")
        if body.role not in ("admin", "member", "owner"):
            raise err(400, "Cargo inválido.")
        if target == me.id:
            raise err(400, "Escolha outra pessoa.")
        if body.role == "owner":  # passa a posse
            async with pool().acquire() as con, con.transaction():
                await con.execute("UPDATE members SET role = 'admin' WHERE server_id = $1 AND user_id = $2", s, me.id)
                await con.execute("UPDATE members SET role = 'owner' WHERE server_id = $1 AND user_id = $2", s, target)
                await con.execute("UPDATE servers SET owner_id = $1 WHERE id = $2", target, s)
        else:
            await pool().execute("UPDATE members SET role = $1 WHERE server_id = $2 AND user_id = $3", body.role, s, target)
        from .voz import refresh_user_voice

        await refresh_user_voice(target, s)
    await announce_server(s)
    return {"ok": True}


# ------------------------------------------------------------------ cargos

async def _role_ids(server_id: int, raw: list[str]) -> list[int]:
    ids = sorted({parse_id(x) for x in raw})
    if ids:
        ok = await pool().fetchval("SELECT count(*) FROM roles WHERE server_id = $1 AND id = ANY($2::bigint[])", server_id, ids)
        if ok != len(ids):
            raise err(400, "Cargo não encontrado.")
    return ids


class RoleIn(BaseModel):
    name: str | None = None
    color: str | None = None
    perms: list[str] | None = None
    position: int | None = None


def _clean_perms(perms: list[str]) -> list[str]:
    if any(p not in PERMS for p in perms):
        raise err(400, "Permissão desconhecida.")
    return sorted(set(perms))


@router.post("/servers/{server_id}/roles")
async def create_role(server_id: str, body: RoleIn, me: Auth = CurrentUser) -> dict:
    s = parse_id(server_id)
    await require_admin(s, me.id)
    name = (body.name or "").strip()[:32]
    if not name:
        raise err(400, "Dê um nome para o cargo.")
    if await pool().fetchval("SELECT count(*) FROM roles WHERE server_id = $1", s) >= 30:
        raise err(400, "Limite de 30 cargos por servidor.")
    color = (body.color or "").lower()
    if color and not HEX_RE.match(color):
        raise err(400, "Cor inválida.")
    pos = await pool().fetchval("SELECT COALESCE(MAX(position), -1) + 1 FROM roles WHERE server_id = $1", s)
    rid = new_id()
    await pool().execute(
        "INSERT INTO roles (id, server_id, name, color, position, perms) VALUES ($1,$2,$3,$4,$5,$6)",
        rid, s, name, color, pos, _clean_perms(body.perms or []),
    )
    await announce_server(s)
    return {"id": sid(rid)}


async def _role(role_id: str, me: int) -> Any:
    row = await pool().fetchrow("SELECT * FROM roles WHERE id = $1", parse_id(role_id))
    if not row:
        raise err(404, "Cargo não encontrado.")
    await require_admin(row["server_id"], me)
    return row


@router.patch("/roles/{role_id}")
async def update_role(role_id: str, body: RoleIn, me: Auth = CurrentUser) -> dict:
    row = await _role(role_id, me.id)
    if body.name is not None:
        name = body.name.strip()[:32]
        if not name:
            raise err(400, "O nome não pode ficar vazio.")
        await pool().execute("UPDATE roles SET name = $1 WHERE id = $2", name, row["id"])
    if body.color is not None:
        if body.color and not HEX_RE.match(body.color):
            raise err(400, "Cor inválida.")
        await pool().execute("UPDATE roles SET color = $1 WHERE id = $2", body.color.lower(), row["id"])
    if body.perms is not None:
        await pool().execute("UPDATE roles SET perms = $1 WHERE id = $2", _clean_perms(body.perms), row["id"])
    if body.position is not None:
        await pool().execute("UPDATE roles SET position = $1 WHERE id = $2", body.position, row["id"])
    await announce_server(row["server_id"])
    return {"ok": True}


@router.delete("/roles/{role_id}")
async def delete_role(role_id: str, me: Auth = CurrentUser) -> dict:
    row = await _role(role_id, me.id)
    async with pool().acquire() as con, con.transaction():
        await con.execute("DELETE FROM roles WHERE id = $1", row["id"])
        # canais restritos a esse cargo deixam de citar ele
        await con.execute(
            "UPDATE channels SET view_roles = array_remove(view_roles, $1), send_roles = array_remove(send_roles, $1) WHERE server_id = $2",
            row["id"], row["server_id"],
        )
    forget_channels(server_id=row["server_id"])
    await announce_server(row["server_id"])
    return {"ok": True}


class MemberRolesIn(BaseModel):
    roles: list[str]


@router.put("/servers/{server_id}/members/{user_id}/roles")
async def set_member_roles(server_id: str, user_id: str, body: MemberRolesIn, me: Auth = CurrentUser) -> dict:
    s, target = parse_id(server_id), parse_id(user_id)
    await require_admin(s, me.id)
    if not await role_in(s, target):
        raise err(404, "Essa pessoa não está no servidor.")
    ids = await _role_ids(s, body.roles)
    async with pool().acquire() as con, con.transaction():
        await con.execute("DELETE FROM member_roles WHERE server_id = $1 AND user_id = $2", s, target)
        for rid in ids:
            await con.execute("INSERT INTO member_roles (server_id, user_id, role_id) VALUES ($1,$2,$3)", s, target, rid)
    await announce_server(s)
    from .voz import refresh_user_voice

    await refresh_user_voice(target, s)
    return {"ok": True}


@router.get("/perms")
async def perms_catalog() -> dict:
    return {"perms": [{"key": k, "label": v} for k, v in PERMS.items()]}


# ------------------------------------------------------------------ canais
class ChannelIn(BaseModel):
    name: str
    type: str = "text"
    topic: str = ""


def clean_channel_name(name: str, kind: str) -> str:
    name = name.strip()[:40]
    if kind == "text":
        name = re.sub(r"\s+", "-", name.lower())
    if not name:
        raise err(400, "Dê um nome para o canal.")
    return name


@router.post("/servers/{server_id}/channels")
async def create_channel(server_id: str, body: ChannelIn, me: Auth = CurrentUser) -> dict:
    s = parse_id(server_id)
    await require_admin(s, me.id)
    if body.type not in ("text", "voice"):
        raise err(400, "Tipo de canal inválido.")
    pos = await pool().fetchval("SELECT COALESCE(MAX(position), -1) + 1 FROM channels WHERE server_id = $1", s)
    cid = new_id()
    await pool().execute(
        "INSERT INTO channels (id, server_id, type, name, topic, position) VALUES ($1,$2,$3,$4,$5,$6)",
        cid, s, body.type, clean_channel_name(body.name, body.type), body.topic.strip()[:200], pos,
    )
    await announce_server(s)
    return channel_out(await pool().fetchrow("SELECT * FROM channels WHERE id = $1", cid))


class ChannelPatch(BaseModel):
    name: str | None = None
    topic: str | None = None
    position: int | None = None
    view_roles: list[str] | None = None
    send_roles: list[str] | None = None
    user_limit: int | None = None



@router.patch("/channels/{channel_id}")
async def update_channel(channel_id: str, body: ChannelPatch, me: Auth = CurrentUser) -> dict:
    cid = parse_id(channel_id)
    ch = await pool().fetchrow("SELECT * FROM channels WHERE id = $1", cid)
    if not ch or ch["server_id"] is None:
        raise err(404, "Canal não encontrado.")
    await require_admin(ch["server_id"], me.id)
    if body.name is not None:
        await pool().execute("UPDATE channels SET name = $1 WHERE id = $2", clean_channel_name(body.name, ch["type"]), cid)
    if body.topic is not None:
        await pool().execute("UPDATE channels SET topic = $1 WHERE id = $2", body.topic.strip()[:200], cid)
    if body.position is not None:
        await pool().execute("UPDATE channels SET position = $1 WHERE id = $2", body.position, cid)
    if body.view_roles is not None:
        await pool().execute("UPDATE channels SET view_roles = $1 WHERE id = $2", await _role_ids(ch["server_id"], body.view_roles), cid)
        forget_channels(cid=cid)
    if body.send_roles is not None:
        await pool().execute("UPDATE channels SET send_roles = $1 WHERE id = $2", await _role_ids(ch["server_id"], body.send_roles), cid)
    if body.user_limit is not None and ch["type"] == "voice":
        await pool().execute("UPDATE channels SET user_limit = $1 WHERE id = $2", max(0, min(99, body.user_limit)), cid)
    if ch["type"] == "voice" and (body.view_roles is not None or body.send_roles is not None):
        from .voz import refresh_channel_voice

        await refresh_channel_voice(cid)
    await announce_server(ch["server_id"])
    return channel_out(await pool().fetchrow("SELECT * FROM channels WHERE id = $1", cid))


@router.delete("/channels/{channel_id}")
async def delete_channel(channel_id: str, me: Auth = CurrentUser) -> dict:
    cid = parse_id(channel_id)
    ch = await pool().fetchrow("SELECT * FROM channels WHERE id = $1", cid)
    if not ch or ch["server_id"] is None:
        raise err(404, "Canal não encontrado.")
    await require_admin(ch["server_id"], me.id)
    if ch["type"] == "voice":
        from .voz import livekit, revoke_voice_participant, room_name

        for user_id in list(hub.voice.get(cid, {})):
            await revoke_voice_participant(cid, user_id, "Esta call foi removida.")
        # DeleteRoom também remove participantes que nunca anunciaram estado no gateway.
        await livekit("DeleteRoom", room_name(cid), {})
    await pool().execute("DELETE FROM channels WHERE id = $1", cid)
    forget_channels(cid=cid)
    await announce_server(ch["server_id"])
    return {"ok": True}


# ------------------------------------------------------------------ convites
class InviteIn(BaseModel):
    max_uses: int | None = None
    expires_hours: int | None = None


def new_code() -> str:
    alphabet = "abcdefghjkmnpqrstuvwxyz23456789"
    return "".join(secrets.choice(alphabet) for _ in range(8))


@router.post("/servers/{server_id}/invites")
async def create_invite(server_id: str, body: InviteIn, me: Auth = CurrentUser) -> dict:
    s = parse_id(server_id)
    await require_member(s, me.id)
    code = new_code()
    expires = datetime.now(timezone.utc) + timedelta(hours=body.expires_hours) if body.expires_hours else None
    await pool().execute(
        "INSERT INTO invites (code, server_id, creator_id, max_uses, expires_at) VALUES ($1,$2,$3,$4,$5)",
        code, s, me.id, body.max_uses, expires,
    )
    return {"code": code}


async def valid_invite(code: str) -> Any:
    inv = await pool().fetchrow(
        """SELECT i.*, s.name, s.description, s.icon_id, s.banner_id, f.animated AS icon_animated, b.animated AS banner_animated
           FROM invites i JOIN servers s ON s.id = i.server_id
           LEFT JOIN files f ON f.id = s.icon_id LEFT JOIN files b ON b.id = s.banner_id
           WHERE i.code = $1""",
        code.strip().lower(),
    )
    if not inv or (inv["expires_at"] and inv["expires_at"] < datetime.now(timezone.utc)) or (
        inv["max_uses"] and inv["uses"] >= inv["max_uses"]
    ):
        raise err(404, "Esse convite não vale mais. Peça um novo para a turma.")
    return inv


@router.get("/invites/{code}")
async def preview_invite(code: str) -> dict:
    inv = await valid_invite(code)
    count = await pool().fetchval("SELECT count(*) FROM members WHERE server_id = $1", inv["server_id"])
    online = sum(
        1 for r in await pool().fetch("SELECT user_id FROM members WHERE server_id = $1", inv["server_id"]) if hub.online(r["user_id"])
    )
    inviter = await pool().fetchval("SELECT display_name FROM users WHERE id = $1", inv["creator_id"]) if inv["creator_id"] else None
    return {
        "code": inv["code"],
        "server": {
            "id": sid(inv["server_id"]),
            "name": inv["name"],
            "description": inv["description"],
            "icon": media(inv["icon_id"], inv["icon_animated"]),
            "banner": media(inv["banner_id"], inv["banner_animated"]),
            "members": count,
            "online": online,
        },
        "inviter": inviter,
    }


@router.post("/invites/{code}/join")
async def join_invite(code: str, me: Auth = CurrentUser) -> dict:
    inv = await valid_invite(code)
    s = inv["server_id"]
    if not await role_in(s, me.id):
        await pool().execute("INSERT INTO members (server_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING", s, me.id)
        await pool().execute("UPDATE invites SET uses = uses + 1 WHERE code = $1", inv["code"])
        # recado de boas-vindas no primeiro canal de texto
        first_text = await pool().fetchval(
            "SELECT id FROM channels WHERE server_id = $1 AND type = 'text' ORDER BY position, id LIMIT 1", s
        )
        if first_text:
            from .messages import post_message  # import tardio: evita ciclo

            await post_message(first_text, me.id, "", kind="join")
        from .bots import on_join  # import tardio: evita ciclo

        await on_join(s, me.id)
        await announce_server(s)
    out = await server_out(s, me.id)
    await hub.send([me.id], "server_create", out)
    return out


# ------------------------------------------------------------------ soundboard
@router.post("/servers/{server_id}/sounds")
async def add_sound(
    server_id: str,
    file: UploadFile,
    name: str = Form(...),
    emoji: str = Form(""),
    volume: float = Form(1.0),
    me: Auth = CurrentUser,
) -> dict:
    s = parse_id(server_id)
    await require_member(s, me.id)
    count = await pool().fetchval("SELECT count(*) FROM sounds WHERE server_id = $1", s)
    if count >= 60:
        raise err(400, "O soundboard está cheio (60 sons). Apague algum antes.")
    clean = name.strip()[:32]
    if not clean:
        raise err(400, "Dê um nome para o som.")
    saved = await save_upload(file, "sound", me.id)
    await pool().execute(
        "INSERT INTO sounds (id, server_id, uploader_id, name, emoji, file_id, volume) VALUES ($1,$2,$3,$4,$5,$6,$7)",
        new_id(), s, me.id, clean, emoji.strip()[:8], int(saved["id"]), max(0.05, min(1.0, volume)),
    )
    await announce_server(s)
    return {"sounds": await sounds_of(s)}


@router.delete("/sounds/{sound_id}")
async def delete_sound(sound_id: str, me: Auth = CurrentUser) -> dict:
    row = await pool().fetchrow("SELECT server_id, uploader_id FROM sounds WHERE id = $1", parse_id(sound_id))
    if not row:
        raise err(404, "Som não encontrado.")
    role = await require_member(row["server_id"], me.id)
    if row["uploader_id"] != me.id and ROLE_RANK[role] < 1:
        raise err(403, "Só quem subiu o som (ou um admin) pode apagar.")
    await pool().execute("DELETE FROM sounds WHERE id = $1", parse_id(sound_id))
    await announce_server(row["server_id"])
    return {"ok": True}


# ------------------------------------------------------------------ emojis do servidor
@router.post("/servers/{server_id}/emojis")
async def add_emoji(server_id: str, file: UploadFile, name: str = Form(...), me: Auth = CurrentUser) -> dict:
    s = parse_id(server_id)
    await require_member(s, me.id)
    clean = name.strip().lower().strip(":")
    if not EMOJI_NAME_RE.match(clean):
        raise err(400, "Nome do emoji: 2 a 32 letras minúsculas, números ou _.")
    if await pool().fetchval("SELECT 1 FROM emojis WHERE server_id = $1 AND lower(name) = $2", s, clean):
        raise err(409, "Já existe um emoji com esse nome.")
    saved = await save_upload(file, "emoji", me.id)
    await pool().execute("INSERT INTO emojis (id, server_id, name, file_id) VALUES ($1,$2,$3,$4)", new_id(), s, clean, int(saved["id"]))
    await announce_server(s)
    return {"emojis": await emojis_of(s)}


@router.delete("/emojis/{emoji_id}")
async def delete_emoji(emoji_id: str, me: Auth = CurrentUser) -> dict:
    row = await pool().fetchrow("SELECT server_id FROM emojis WHERE id = $1", parse_id(emoji_id))
    if not row:
        raise err(404, "Emoji não encontrado.")
    await require_admin(row["server_id"], me.id)
    await pool().execute("DELETE FROM emojis WHERE id = $1", parse_id(emoji_id))
    await announce_server(row["server_id"])
    return {"ok": True}
