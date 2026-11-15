"""Figurinhas próprias, busca de GIFs (GIPHY), Steam ("jogando agora" e jogos recentes) e webhooks para bots."""

from __future__ import annotations

import asyncio
import hashlib
import os
import re
import secrets
import time
from collections import deque
from typing import Any

import httpx
from fastapi import APIRouter, Request, UploadFile
from pydantic import BaseModel

from ..core import Auth, CurrentUser, err, file_url, new_id, parse_id, pool, settings, sid
from ..files import file_access_allowed, save_upload
from ..realtime import hub
from .servers import require_admin

router = APIRouter()

GIPHY_BASE = os.environ.get("GIPHY_API_BASE", "https://api.giphy.com").rstrip("/")
STEAM_BASE = os.environ.get("STEAM_API_BASE", "https://api.steampowered.com").rstrip("/")
STEAM_POLL = max(5, int(os.environ.get("STEAM_POLL_SECONDS", "60")))


@router.get("/features")
async def features() -> dict:
    """O que está ligado neste servidor (o app esconde o que não tiver chave)."""
    return {"gifs": bool(settings.giphy_key), "steam": bool(settings.steam_key)}


# ------------------------------------------------------------------ figurinhas
MAX_STICKERS = 150


async def stickers_of(user_id: int) -> list[dict]:
    rows = await pool().fetch(
        """SELECT s.id, s.name, s.file_id, s.favorite, s.folder, f.width, f.height, f.animated FROM stickers s JOIN files f ON f.id = s.file_id
           WHERE s.user_id = $1 ORDER BY s.created_at DESC""",
        user_id,
    )
    return [
        {"id": sid(r["id"]), "name": r["name"], "file_id": sid(r["file_id"]), "url": file_url(r["file_id"]),
         "width": r["width"], "height": r["height"], "animated": r["animated"], "favorite": r["favorite"], "folder": r["folder"]}
        for r in rows
    ]


async def _room_for_sticker(user_id: int) -> None:
    if await pool().fetchval("SELECT count(*) FROM stickers WHERE user_id = $1", user_id) >= MAX_STICKERS:
        raise err(400, f"Sua coleção já tem {MAX_STICKERS} figurinhas. Apague alguma antes.")


@router.get("/me/stickers")
async def my_stickers(me: Auth = CurrentUser) -> list[dict]:
    return await stickers_of(me.id)


@router.post("/me/stickers")
async def add_sticker(file: UploadFile, me: Auth = CurrentUser) -> list[dict]:
    await _room_for_sticker(me.id)
    saved = await save_upload(file, "sticker", me.id)
    name = re.sub(r"\.[a-z0-9]+$", "", saved["name"], flags=re.I)[:40]
    await pool().execute("INSERT INTO stickers (id, user_id, name, file_id) VALUES ($1,$2,$3,$4)", new_id(), me.id, name, int(saved["id"]))
    return await stickers_of(me.id)


class SaveStickerIn(BaseModel):
    file_id: str


@router.post("/me/stickers/save")
async def save_sticker(body: SaveStickerIn, me: Auth = CurrentUser) -> list[dict]:
    """Salva na sua coleção uma figurinha que alguém mandou."""
    fid = parse_id(body.file_id)
    row = await pool().fetchrow("SELECT id, owner_id, kind, name FROM files WHERE id = $1 AND kind = 'sticker'", fid)
    if not row:
        raise err(404, "Figurinha não encontrada.")
    if not await file_access_allowed(row, me):
        raise err(404, "Figurinha não encontrada.")
    await _room_for_sticker(me.id)
    name = re.sub(r"\.[a-z0-9]+$", "", row["name"], flags=re.I)[:40]
    await pool().execute(
        "INSERT INTO stickers (id, user_id, name, file_id) VALUES ($1,$2,$3,$4) ON CONFLICT (user_id, file_id) DO NOTHING",
        new_id(), me.id, name, fid,
    )
    return await stickers_of(me.id)


class StickerEditIn(BaseModel):
    name: str | None = None
    favorite: bool | None = None
    folder: str | None = None


@router.patch("/me/stickers/{sticker_id}")
async def edit_sticker(sticker_id: str, body: StickerEditIn, me: Auth = CurrentUser) -> list[dict]:
    """Renomear, favoritar ou mudar de pasta (pasta vazia = sem pasta)."""
    st = parse_id(sticker_id)
    if not await pool().fetchval("SELECT 1 FROM stickers WHERE id = $1 AND user_id = $2", st, me.id):
        raise err(404, "Figurinha não encontrada.")
    if body.name is not None:
        name = body.name.strip()[:40]
        if not name:
            raise err(400, "Dê um nome para a figurinha.")
        await pool().execute("UPDATE stickers SET name = $1 WHERE id = $2", name, st)
    if body.favorite is not None:
        await pool().execute("UPDATE stickers SET favorite = $1 WHERE id = $2", body.favorite, st)
    if body.folder is not None:
        folder = re.sub(r"\s+", " ", body.folder).strip()[:24]
        if folder and folder not in {r["folder"] for r in await pool().fetch("SELECT DISTINCT folder FROM stickers WHERE user_id = $1", me.id)}:
            if await pool().fetchval("SELECT count(DISTINCT folder) FROM stickers WHERE user_id = $1 AND folder <> ''", me.id) >= 20:
                raise err(400, "No máximo 20 pastas.")
        await pool().execute("UPDATE stickers SET folder = $1 WHERE id = $2", folder, st)
    return await stickers_of(me.id)


@router.delete("/me/stickers/{sticker_id}")
async def delete_sticker(sticker_id: str, me: Auth = CurrentUser) -> list[dict]:
    await pool().execute("DELETE FROM stickers WHERE id = $1 AND user_id = $2", parse_id(sticker_id), me.id)
    return await stickers_of(me.id)


# ------------------------------------------------------------------ GIFs (GIPHY)
GIF_URL = re.compile(r"^https://(media\d?|i)\.giphy\.com/[A-Za-z0-9/_.\-?=&]+$")
_gif_cache: dict[str, tuple[float, list[dict]]] = {}


def _gif_out(d: dict) -> dict | None:
    imgs = d.get("images") or {}
    full = imgs.get("fixed_height") or imgs.get("downsized") or {}
    small = imgs.get("fixed_height_small") or imgs.get("preview_gif") or full
    url = full.get("webp") or full.get("url")
    if not url or not GIF_URL.match(url):
        return None
    return {
        "id": d.get("id"),
        "title": (d.get("title") or "GIF")[:80],
        "url": url,
        "preview": small.get("webp") or small.get("url") or url,
        "width": int(full.get("width") or 200),
        "height": int(full.get("height") or 200),
    }


@router.get("/gifs")
async def search_gifs(q: str = "", kind: str = "gifs", me: Auth = CurrentUser) -> list[dict]:
    if not settings.giphy_key:
        raise err(503, "A busca de GIFs não está ligada neste servidor (falta GIPHY_API_KEY).")
    kind = "stickers" if kind == "stickers" else "gifs"
    q = q.strip()[:60]
    key = f"{kind}:{q.lower()}"
    hit = _gif_cache.get(key)
    if hit and time.monotonic() - hit[0] < 300:
        return hit[1]
    params = {"api_key": settings.giphy_key, "limit": "30", "rating": "pg-13", "lang": "pt"}
    path = f"/v1/{kind}/trending"
    if q:
        path = f"/v1/{kind}/search"
        params["q"] = q
    try:
        async with httpx.AsyncClient(timeout=8) as c:
            r = await c.get(GIPHY_BASE + path, params=params)
        data = r.json().get("data", []) if r.status_code == 200 else None
    except Exception:
        data = None
    if data is None:
        raise err(502, "A busca de GIFs não respondeu. Tenta de novo.")
    out = [g for g in (_gif_out(d) for d in data) if g]
    _gif_cache[key] = (time.monotonic(), out)
    if len(_gif_cache) > 300:
        _gif_cache.pop(next(iter(_gif_cache)))
    return out


# ------------------------------------------------------------------ Steam
STEAM_ID = re.compile(r"^\d{17}$")


async def steam_get(path: str, **params: str) -> dict | None:
    try:
        async with httpx.AsyncClient(timeout=8) as c:
            r = await c.get(STEAM_BASE + path, params={"key": settings.steam_key, **params})
        return r.json() if r.status_code == 200 else None
    except Exception:
        return None


async def resolve_steam(text: str) -> str:
    text = text.strip()
    if m := re.search(r"steamcommunity\.com/profiles/(\d{17})", text):
        return m.group(1)
    if STEAM_ID.match(text):
        return text
    vanity = text
    if m := re.search(r"steamcommunity\.com/id/([A-Za-z0-9_-]+)", text):
        vanity = m.group(1)
    if not re.fullmatch(r"[A-Za-z0-9_-]{2,64}", vanity):
        raise err(400, "Cole o link do seu perfil da Steam (steamcommunity.com/id/... ou /profiles/...).")
    got = await steam_get("/ISteamUser/ResolveVanityURL/v1/", vanityurl=vanity)
    res = (got or {}).get("response", {})
    if res.get("success") != 1 or not res.get("steamid"):
        raise err(404, "Não achei esse perfil na Steam.")
    return str(res["steamid"])


async def summaries(steam_ids: list[str]) -> dict[str, dict]:
    out: dict[str, dict] = {}
    for i in range(0, len(steam_ids), 100):
        got = await steam_get("/ISteamUser/GetPlayerSummaries/v2/", steamids=",".join(steam_ids[i : i + 100]))
        for p in ((got or {}).get("response", {}).get("players", [])):
            out[str(p.get("steamid"))] = p
    return out


def game_of(p: dict | None) -> dict | None:
    if not p or not p.get("gameextrainfo"):
        return None
    return {"name": str(p["gameextrainfo"])[:80], "appid": str(p.get("gameid") or "")}


class SteamIn(BaseModel):
    profile: str = ""


@router.put("/me/steam")
async def link_steam(body: SteamIn, me: Auth = CurrentUser) -> dict:
    if not body.profile.strip():
        await pool().execute("UPDATE users SET steam_id = '' WHERE id = $1", me.id)
        if hub.steam_games.pop(me.id, None):
            await hub.update_game(me.id)
        return {"steam": None}
    if not settings.steam_key:
        raise err(503, "A Steam não está ligada neste servidor (falta STEAM_API_KEY).")
    steam_id = await resolve_steam(body.profile)
    found = (await summaries([steam_id])).get(steam_id)
    if not found:
        raise err(404, "Não achei esse perfil na Steam.")
    await pool().execute("UPDATE users SET steam_id = $1 WHERE id = $2", steam_id, me.id)
    _steam_cache.pop(me.id, None)
    return {"steam": await steam_profile(me.id)}


_steam_cache: dict[int, tuple[float, dict | None]] = {}


async def steam_profile(user_id: int) -> dict | None:
    hit = _steam_cache.get(user_id)
    if hit and time.monotonic() - hit[0] < 60:
        return hit[1]
    steam_id = await pool().fetchval("SELECT steam_id FROM users WHERE id = $1", user_id)
    if not steam_id or not settings.steam_key:
        return None
    p = (await summaries([steam_id])).get(steam_id)
    recent = await steam_get("/IPlayerService/GetRecentlyPlayedGames/v1/", steamid=steam_id, count="6")
    games = (recent or {}).get("response", {}).get("games", [])
    out = {
        "name": (p or {}).get("personaname", ""),
        "url": (p or {}).get("profileurl") or f"https://steamcommunity.com/profiles/{steam_id}",
        # perfil fechado: a Steam não mostra o que a pessoa joga
        "public": (p or {}).get("communityvisibilitystate") == 3,
        "playing": game_of(p),
        "recent": [
            {
                "appid": str(g.get("appid")),
                "name": str(g.get("name", ""))[:80],
                "hours_2weeks": round((g.get("playtime_2weeks") or 0) / 60, 1),
                "hours_total": round((g.get("playtime_forever") or 0) / 60),
                "image": f"https://cdn.cloudflare.steamstatic.com/steam/apps/{int(g.get('appid') or 0)}/capsule_184x69.jpg",
            }
            for g in games
        ],
    }
    _steam_cache[user_id] = (time.monotonic(), out)
    return out


@router.get("/users/{user_id}/steam")
async def get_steam(user_id: str, me: Auth = CurrentUser) -> dict:
    uid = parse_id(user_id)
    if uid != me.id and uid not in await hub.audience_of(me.id):
        raise err(404, "Usuário não encontrado.")
    return {"steam": await steam_profile(uid)}


async def steam_loop() -> None:
    """A cada minuto, vê o que quem está online está jogando e avisa quem mudou."""
    while True:
        try:
            rows = await pool().fetch("SELECT id, steam_id FROM users WHERE steam_id <> ''")
            online = {r["id"]: r["steam_id"] for r in rows if hub.online(r["id"])}
            found = await summaries(list(set(online.values()))) if online else {}
            for uid in set(hub.steam_games) | set(online):
                g = game_of(found.get(online[uid])) if uid in online else None
                if g != hub.steam_games.get(uid):
                    if g:
                        hub.steam_games[uid] = g
                    else:
                        hub.steam_games.pop(uid, None)
                    await hub.update_game(uid)
        except asyncio.CancelledError:
            raise
        except Exception:
            pass
        await asyncio.sleep(STEAM_POLL)


# ------------------------------------------------------------------ jogo achado pelo app de Windows
class GameIn(BaseModel):
    name: str | None = None


@router.put("/me/game")
async def set_app_game(body: GameIn, me: Auth = CurrentUser) -> dict:
    """O app de Windows vê qual jogo está aberto no PC e avisa aqui (some quando o app desconecta)."""
    name = re.sub(r"\s+", " ", (body.name or "")).strip()[:80]
    if name:
        hub.app_games[me.id] = {"name": name, "appid": "", "source": "app"}
    else:
        hub.app_games.pop(me.id, None)
    await hub.update_game(me.id)
    return {"game": hub.games.get(me.id)}


# ------------------------------------------------------------------ webhooks (bots)
def _hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


async def _text_channel_admin(channel_id: int, user_id: int) -> dict:
    ch = await pool().fetchrow("SELECT id, server_id, type, name FROM channels WHERE id = $1", channel_id)
    if not ch or ch["server_id"] is None or ch["type"] != "text":
        raise err(404, "Canal de texto não encontrado.")
    await require_admin(ch["server_id"], user_id)
    return dict(ch)


@router.get("/channels/{channel_id}/webhooks")
async def list_webhooks(channel_id: str, me: Auth = CurrentUser) -> list[dict]:
    cid = parse_id(channel_id)
    await _text_channel_admin(cid, me.id)
    rows = await pool().fetch("SELECT id, name, created_at, command_url, commands FROM webhooks WHERE channel_id = $1 ORDER BY created_at", cid)
    return [
        {"id": sid(r["id"]), "name": r["name"], "created_at": r["created_at"].isoformat(), "command_url": r["command_url"], "commands": list(r["commands"])}
        for r in rows
    ]


class WebhookIn(BaseModel):
    name: str


@router.post("/channels/{channel_id}/webhooks")
async def create_webhook(channel_id: str, body: WebhookIn, me: Auth = CurrentUser) -> dict:
    cid = parse_id(channel_id)
    await _text_channel_admin(cid, me.id)
    name = body.name.strip()[:40]
    if len(name) < 2:
        raise err(400, "Dê um nome para o bot (2 a 40 letras).")
    if await pool().fetchval("SELECT count(*) FROM webhooks WHERE channel_id = $1", cid) >= 10:
        raise err(400, "Esse canal já tem 10 webhooks.")
    wid, token = new_id(), secrets.token_urlsafe(32)
    await pool().execute(
        "INSERT INTO webhooks (id, channel_id, name, token_hash, created_by) VALUES ($1,$2,$3,$4,$5)", wid, cid, name, _hash(token), me.id
    )
    # o link completo só aparece agora: depois só dá para apagar e criar outro
    return {"id": sid(wid), "name": name, "url": f"{settings.public_url}/webhooks/{sid(wid)}/{token}"}


@router.delete("/webhooks/{webhook_id}")
async def delete_webhook(webhook_id: str, me: Auth = CurrentUser) -> dict:
    wid = parse_id(webhook_id)
    cid = await pool().fetchval("SELECT channel_id FROM webhooks WHERE id = $1", wid)
    if not cid:
        raise err(404, "Webhook não encontrado.")
    await _text_channel_admin(cid, me.id)
    await pool().execute("DELETE FROM webhooks WHERE id = $1", wid)
    return {"ok": True}


_hook_hits: dict[int, deque[float]] = {}


@router.post("/webhooks/{webhook_id}/{token}")
async def run_webhook(webhook_id: str, token: str, request: Request) -> dict:
    """Manda mensagem como bot. Aceita o mesmo formato básico do Discord: {"content": "...", "username": "..."}."""
    try:
        wid = parse_id(webhook_id)
    except Exception:
        raise err(404, "Webhook não encontrado.")
    row = await pool().fetchrow("SELECT id, channel_id, name, token_hash FROM webhooks WHERE id = $1", wid)
    if not row or not secrets.compare_digest(row["token_hash"], _hash(token)):
        raise err(404, "Webhook não encontrado.")
    q = _hook_hits.setdefault(wid, deque())
    now = time.monotonic()
    while q and now - q[0] > 60:
        q.popleft()
    if len(q) >= 30:
        raise err(429, "Calma: no máximo 30 mensagens por minuto por webhook.")
    q.append(now)
    try:
        body = await request.json()
    except Exception:
        form = await request.form()
        body = dict(form)
    if not isinstance(body, dict):
        raise err(400, "Mande um JSON com o campo content.")
    content = str(body.get("content") or "").strip()
    # embeds simples do Discord viram texto
    for e in (body.get("embeds") or [])[:5] if isinstance(body.get("embeds"), list) else []:
        if isinstance(e, dict):
            parts = [str(e.get(k) or "").strip() for k in ("title", "description", "url")]
            content += ("\n" if content else "") + "\n".join(p for p in parts if p)
    content = content[:4000]
    if not content:
        raise err(400, "Mensagem vazia (campo content).")
    name = str(body.get("username") or row["name"]).strip()[:40] or row["name"]
    from .messages import post_webhook_message  # aqui para não dar ciclo

    msg = await post_webhook_message(row["channel_id"], wid, name, content)
    return {"id": msg["id"], "channel_id": msg["channel_id"]}
