"""Perfil, amizades e conversas diretas."""

from __future__ import annotations

import json
import re
from typing import Any

import asyncpg
from fastapi import APIRouter, UploadFile
from pydantic import BaseModel

from ..core import (
    USER_COLUMNS, USER_JOINS, Auth, CurrentUser, err, fetch_user, new_id, parse_id, pool, sid, user_out,
)
from ..files import save_upload
from ..realtime import hub
from .auth import validate_username

router = APIRouter()

STATUSES = {"online", "idle", "dnd", "invisible"}
HEX_RE = re.compile(r"^#[0-9a-fA-F]{6}$")


async def public_user(user_id: int) -> dict[str, Any]:
    row = await fetch_user(user_id)
    if not row:
        raise err(404, "Pessoa não encontrada.")
    return user_out(row, presence=hub.presence(user_id, row["status"]))


async def me_out(user_id: int) -> dict[str, Any]:
    row = await fetch_user(user_id)
    assert row
    extra = await pool().fetchrow("SELECT email, password_hash IS NOT NULL AS has_password, google_sub IS NOT NULL AS has_google FROM users WHERE id = $1", user_id)
    out = user_out(row)
    out.update({"email": extra["email"], "has_password": extra["has_password"], "has_google": extra["has_google"]})
    from .uso import is_platform_admin

    out["platform_admin"] = is_platform_admin(user_id)
    return out


async def announce_user(user_id: int) -> None:
    await hub.to_audience(user_id, "user_update", await public_user(user_id))


@router.get("/me")
async def get_me(me: Auth = CurrentUser) -> dict:
    return await me_out(me.id)


class MeIn(BaseModel):
    display_name: str | None = None
    username: str | None = None
    bio: str | None = None
    accent: str | None = None
    status: str | None = None
    custom_status: str | None = None
    pronouns: str | None = None
    name_color: str | None = None
    theme: list[str] | None = None
    badges: list[str] | None = None
    # enfeites de conquista: {"name": "rgb", "plate": "founder", ...}; vazio tira
    flair: dict[str, str] | None = None


# insígnias que dá para escolher (o site tem a mesma lista em lib/badges.ts)
BADGES = {
    "gamer", "otaku", "dj", "artista", "streamer", "coruja", "cafe", "pizza",
    "boss", "sono", "carry", "noob", "cozinha", "cinema", "leitura", "pet",
}
MAX_BADGES = 4


@router.get("/usernames/check")
async def check_username(u: str, me: Auth = CurrentUser) -> dict:
    try:
        name = validate_username(u)
    except Exception as e:  # formato inválido
        return {"ok": False, "reason": getattr(e, "detail", "Nome inválido.")}
    row = await pool().fetchrow("SELECT id FROM users WHERE lower(username) = $1", name.lower())
    if row and row["id"] != me.id:
        return {"ok": False, "reason": "Já tem alguém com esse @."}
    return {"ok": True, "username": name}


@router.patch("/me")
async def update_me(body: MeIn, me: Auth = CurrentUser) -> dict:
    sets: dict[str, Any] = {}
    if body.display_name is not None:
        name = body.display_name.strip()[:32]
        if not name:
            raise err(400, "O nome não pode ficar vazio.")
        sets["display_name"] = name
    if body.username is not None:
        sets["username"] = validate_username(body.username)
    if body.bio is not None:
        sets["bio"] = body.bio.strip()[:300]
    if body.accent is not None:
        if not HEX_RE.match(body.accent):
            raise err(400, "Cor inválida.")
        sets["accent"] = body.accent.lower()
    if body.status is not None:
        if body.status not in STATUSES:
            raise err(400, "Status inválido.")
        sets["status"] = body.status
    if body.custom_status is not None:
        sets["custom_status"] = body.custom_status.strip()[:80]
    if body.pronouns is not None:
        sets["pronouns"] = body.pronouns.strip()[:24]
    if body.name_color is not None:
        if body.name_color and not HEX_RE.match(body.name_color):
            raise err(400, "Cor inválida.")
        sets["name_color"] = body.name_color.lower()
    if body.theme is not None:
        if len(body.theme) not in (0, 2) or not all(HEX_RE.match(c) for c in body.theme):
            raise err(400, "O tema precisa de duas cores.")
        sets["theme"] = [c.lower() for c in body.theme]
    if body.badges is not None:
        picked = list(dict.fromkeys(body.badges))
        if len(picked) > MAX_BADGES or any(b not in BADGES for b in picked):
            raise err(400, f"Escolha até {MAX_BADGES} insígnias da lista.")
        sets["badges"] = picked
    if body.flair is not None:
        from ..conquistas import SLOTS, clean_flair, unlocked_for

        unlocked = await unlocked_for(me.id)
        wanted = {k: v for k, v in body.flair.items() if k in SLOTS and v}
        kept = clean_flair(wanted, unlocked)
        if kept != wanted:
            raise err(400, "Esse enfeite ainda não foi liberado.")
        current = await pool().fetchval("SELECT flair FROM users WHERE id = $1", me.id)
        from ..conquistas import parse_flair

        merged = {**parse_flair(current), **{k: v for k, v in body.flair.items() if k in SLOTS}}
        sets["flair"] = json.dumps(clean_flair(merged, unlocked))
    if sets:
        cols = ", ".join(f"{k} = ${i + 2}" for i, k in enumerate(sets))
        try:
            await pool().execute(f"UPDATE users SET {cols} WHERE id = $1", me.id, *sets.values())
        except asyncpg.UniqueViolationError:
            raise err(409, "Esse nome de usuário já está em uso.")
        await announce_user(me.id)
        if "status" in sets or "custom_status" in sets:
            await hub.broadcast_presence(me.id)
    return await me_out(me.id)


async def _set_media(me: Auth, column: str, file: UploadFile | None, kind: str) -> dict:
    file_id = None
    if file is not None:
        saved = await save_upload(file, kind, me.id)
        file_id = int(saved["id"])
    await pool().execute(f"UPDATE users SET {column} = $1 WHERE id = $2", file_id, me.id)
    await announce_user(me.id)
    return await me_out(me.id)


@router.post("/me/avatar")
async def set_avatar(file: UploadFile, me: Auth = CurrentUser) -> dict:
    return await _set_media(me, "avatar_id", file, "avatar")


@router.delete("/me/avatar")
async def clear_avatar(me: Auth = CurrentUser) -> dict:
    return await _set_media(me, "avatar_id", None, "avatar")


@router.post("/me/banner")
async def set_banner(file: UploadFile, me: Auth = CurrentUser) -> dict:
    return await _set_media(me, "banner_id", file, "banner")


@router.delete("/me/banner")
async def clear_banner(me: Auth = CurrentUser) -> dict:
    return await _set_media(me, "banner_id", None, "banner")


@router.post("/me/join-sound")
async def set_join_sound(file: UploadFile, me: Auth = CurrentUser) -> dict:
    return await _set_media(me, "join_sound_id", file, "sound")


@router.delete("/me/join-sound")
async def clear_join_sound(me: Auth = CurrentUser) -> dict:
    return await _set_media(me, "join_sound_id", None, "sound")


@router.get("/users/{user_id}")
async def get_user(user_id: str, me: Auth = CurrentUser) -> dict:
    uid = parse_id(user_id)
    out = await public_user(uid)
    # servidores em comum, para o cartão de perfil
    rows = await pool().fetch(
        """SELECT s.id, s.name FROM servers s
           JOIN members a ON a.server_id = s.id AND a.user_id = $1
           JOIN members b ON b.server_id = s.id AND b.user_id = $2""",
        me.id, uid,
    )
    out["mutual_servers"] = [{"id": sid(r["id"]), "name": r["name"]} for r in rows]
    rel = await relation(me.id, uid)
    out["relation"] = rel
    return out


# ------------------------------------------------------------------ amizades
async def relation(me: int, other: int) -> str:
    """none | friends | outgoing | incoming | self"""
    if me == other:
        return "self"
    row = await pool().fetchrow(
        "SELECT requester_id, status FROM friendships WHERE (requester_id=$1 AND addressee_id=$2) OR (requester_id=$2 AND addressee_id=$1)",
        me, other,
    )
    if not row:
        return "none"
    if row["status"] == "accepted":
        return "friends"
    return "outgoing" if row["requester_id"] == me else "incoming"


async def friends_of(user_id: int) -> list[dict]:
    rows = await pool().fetch(
        f"""
        SELECT {USER_COLUMNS}, f.status AS rel_status, (f.requester_id = $1) AS outgoing
        FROM friendships f
        JOIN users u ON u.id = CASE WHEN f.requester_id = $1 THEN f.addressee_id ELSE f.requester_id END
        {USER_JOINS}
        WHERE f.requester_id = $1 OR f.addressee_id = $1
        ORDER BY u.display_name
        """,
        user_id,
    )
    out = []
    for r in rows:
        rel = "friends" if r["rel_status"] == "accepted" else ("outgoing" if r["outgoing"] else "incoming")
        out.append({"user": user_out(r, presence=hub.presence(r["id"], r["status"])), "relation": rel})
    return out


@router.get("/friends")
async def list_friends(me: Auth = CurrentUser) -> list[dict]:
    return await friends_of(me.id)


class FriendIn(BaseModel):
    username: str


async def _notify_friend_change(a: int, b: int) -> None:
    for x, y in ((a, b), (b, a)):
        await hub.send([x], "relation", {"user": await public_user(y), "relation": await relation(x, y)})


@router.post("/friends")
async def add_friend(body: FriendIn, me: Auth = CurrentUser) -> dict:
    target = await pool().fetchrow("SELECT id FROM users WHERE lower(username) = $1", body.username.strip().lower().lstrip("@"))
    if not target:
        raise err(404, "Não achei ninguém com esse usuário. Confira o @.")
    other = target["id"]
    if other == me.id:
        raise err(400, "Você já é seu melhor amigo. 🙂")
    rel = await relation(me.id, other)
    if rel == "friends":
        raise err(409, "Vocês já são amigos.")
    if rel == "incoming":
        await pool().execute("UPDATE friendships SET status='accepted' WHERE requester_id=$1 AND addressee_id=$2", other, me.id)
    elif rel == "none":
        await pool().execute("INSERT INTO friendships (requester_id, addressee_id) VALUES ($1, $2)", me.id, other)
    await _notify_friend_change(me.id, other)
    return {"relation": await relation(me.id, other)}


@router.post("/friends/{user_id}/accept")
async def accept_friend(user_id: str, me: Auth = CurrentUser) -> dict:
    other = parse_id(user_id)
    res = await pool().execute(
        "UPDATE friendships SET status='accepted' WHERE requester_id=$1 AND addressee_id=$2 AND status='pending'", other, me.id
    )
    if res.endswith(" 0"):
        raise err(404, "Pedido não encontrado.")
    await _notify_friend_change(me.id, other)
    return {"relation": "friends"}


@router.delete("/friends/{user_id}")
async def remove_friend(user_id: str, me: Auth = CurrentUser) -> dict:
    other = parse_id(user_id)
    await pool().execute(
        "DELETE FROM friendships WHERE (requester_id=$1 AND addressee_id=$2) OR (requester_id=$2 AND addressee_id=$1)", me.id, other
    )
    await _notify_friend_change(me.id, other)
    return {"relation": "none"}


# ------------------------------------------------------------------ conversas diretas
async def dm_out(channel_id: int, viewer: int) -> dict:
    row = await pool().fetchrow("SELECT id, last_message_id, created_at FROM channels WHERE id = $1", channel_id)
    rows = await pool().fetch("SELECT user_id FROM dm_participants WHERE channel_id = $1", channel_id)
    others = [r["user_id"] for r in rows if r["user_id"] != viewer]
    users = [await public_user(u) for u in others]
    return {
        "id": sid(channel_id),
        "type": "dm",
        "recipients": users,
        "last_message_id": sid(row["last_message_id"]) if row else None,
    }


async def list_dms(user_id: int) -> list[dict]:
    rows = await pool().fetch(
        """SELECT c.id FROM channels c JOIN dm_participants d ON d.channel_id = c.id
           WHERE d.user_id = $1 ORDER BY COALESCE(c.last_message_id, c.id) DESC""",
        user_id,
    )
    return [await dm_out(r["id"], user_id) for r in rows]


@router.get("/dms")
async def get_dms(me: Auth = CurrentUser) -> list[dict]:
    return await list_dms(me.id)


class DmIn(BaseModel):
    user_id: str


@router.post("/dms")
async def open_dm(body: DmIn, me: Auth = CurrentUser) -> dict:
    other = parse_id(body.user_id)
    if other == me.id:
        raise err(400, "Escolha outra pessoa.")
    if not await pool().fetchval("SELECT 1 FROM users WHERE id = $1", other):
        raise err(404, "Pessoa não encontrada.")
    existing = await pool().fetchval(
        """SELECT a.channel_id FROM dm_participants a
           JOIN dm_participants b ON b.channel_id = a.channel_id AND b.user_id = $2
           WHERE a.user_id = $1
           AND (SELECT count(*) FROM dm_participants c WHERE c.channel_id = a.channel_id) = 2
           LIMIT 1""",
        me.id, other,
    )
    if existing:
        return await dm_out(existing, me.id)
    cid = new_id()
    async with pool().acquire() as con, con.transaction():
        await con.execute("INSERT INTO channels (id, type) VALUES ($1, 'dm')", cid)
        await con.executemany("INSERT INTO dm_participants (channel_id, user_id) VALUES ($1, $2)", [(cid, me.id), (cid, other)])
    for u in (me.id, other):
        await hub.send([u], "dm_create", await dm_out(cid, u))
    return await dm_out(cid, me.id)
