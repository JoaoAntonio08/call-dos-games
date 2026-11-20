"""Prévia e importação conservadora de modelos públicos do Discord."""
from __future__ import annotations

import hashlib
import json
import re
from typing import Any

import httpx
from fastapi import APIRouter
from pydantic import BaseModel

from ..core import Auth, CurrentUser, err, new_id, parse_id, pool
from .servers import announce_server, clean_channel_name, require_admin

router = APIRouter()
CODE = re.compile(r"^[A-Za-z0-9_-]{2,64}$")
LINK = re.compile(r"^https://discord\.new/([A-Za-z0-9_-]{2,64})/?$")
VIEW_CHANNEL = 1 << 10
ADMINISTRATOR = 1 << 3
MAX_CHANNELS = 100


class PreviewIn(BaseModel):
    template: str


class ImportIn(PreviewIn):
    selected: list[str]
    mode: str = "add"
    fingerprint: str


def code_of(value: str) -> str:
    value = value.strip()
    match = LINK.fullmatch(value)
    code = match.group(1) if match else value
    if not CODE.fullmatch(code) or ("://" in value and not match):
        raise err(400, "Código de modelo inválido.")
    return code


async def fetch_template(code: str) -> dict:
    try:
        async with httpx.AsyncClient(timeout=8, follow_redirects=False) as client:
            async with client.stream("GET", f"https://discord.com/api/v10/guilds/templates/{code}") as response:
                if response.status_code == 404:
                    raise err(404, "Modelo não encontrado.")
                if response.status_code != 200:
                    raise err(502, "Discord indisponível.")
                content = bytearray()
                async for chunk in response.aiter_bytes():
                    content.extend(chunk)
                    if len(content) > 512_000:
                        raise err(502, "Modelo grande demais.")
        data = json.loads(content)
        if not isinstance(data, dict):
            raise ValueError("invalid template")
        return data
    except (httpx.HTTPError, ValueError) as exc:
        raise err(502, "Não foi possível consultar o modelo.") from exc


def _integer(value: Any) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return 0


def preview(data: dict) -> dict:
    source = data.get("serialized_source_guild")
    if not isinstance(source, dict) or not isinstance(source.get("channels"), list):
        raise err(502, "Modelo inválido.")
    raw = source["channels"]
    if len(raw) > MAX_CHANNELS:
        raise err(400, "Modelo excede o limite de canais.")
    categories = {str(c.get("id")): c for c in raw if isinstance(c, dict) and c.get("type") == 4}
    roles = {str(r.get("id")): _integer(r.get("permissions")) for r in source.get("roles", []) if isinstance(r, dict)}
    everyone = roles.get("0", 0)
    channels = []
    for c in raw:
        if not isinstance(c, dict) or c.get("type") not in (0, 2):
            continue
        if not str(c.get("id", "")).isdigit():
            raise err(502, "ID de canal inválido.")
        parent = categories.get(str(c.get("parent_id")))
        private = not bool(everyone & (VIEW_CHANNEL | ADMINISTRATOR)) or (c.get("parent_id") is not None and parent is None)
        for item in (parent, c):
            if not item:
                continue
            if not isinstance(item.get("permission_overwrites", []), list):
                private = True
                continue
            for overwrite in item.get("permission_overwrites") or []:
                if not isinstance(overwrite, dict):
                    continue
                if str(overwrite.get("id")) in ("0", str(source.get("id")), str(data.get("source_guild_id"))) and _integer(overwrite.get("type")) == 0:
                    denied = _integer(overwrite.get("deny"))
                    allowed = _integer(overwrite.get("allow"))
                    if denied & VIEW_CHANNEL:
                        private = True
                    if allowed & VIEW_CHANNEL:
                        private = False
        name = c.get("name")
        if not isinstance(name, str) or not name.strip() or len(name) > 100:
            raise err(502, "Nome de canal inválido.")
        channels.append({
            "id": str(c.get("id")), "name": name, "type": "text" if c["type"] == 0 else "voice",
            "category": str(parent.get("name") or "") if parent else "",
            "category_position": _integer(parent.get("position")) if parent else -1,
            "position": _integer(c.get("position")), "private": private,
            "user_limit": min(99, max(0, _integer(c.get("user_limit")))) if c["type"] == 2 else 0,
        })
    channels.sort(key=lambda c: (c["category_position"], c["category"], c["position"], c["id"]))
    ids = [c["id"] for c in channels]
    if len(set(ids)) != len(ids):
        raise err(502, "IDs duplicados no modelo.")
    fingerprint = hashlib.sha256(json.dumps(channels, sort_keys=True, ensure_ascii=False).encode()).hexdigest()
    return {"name": str(data.get("name") or "")[:100], "channels": channels, "fingerprint": fingerprint}


@router.post("/servers/{server_id}/discord-template/preview")
async def preview_template(server_id: str, body: PreviewIn, me: Auth = CurrentUser) -> dict:
    await require_admin(parse_id(server_id), me.id)
    return preview(await fetch_template(code_of(body.template)))


@router.post("/servers/{server_id}/discord-template/import")
async def import_template(server_id: str, body: ImportIn, me: Auth = CurrentUser) -> dict:
    server = parse_id(server_id)
    await require_admin(server, me.id)
    if body.mode not in ("add", "replace") or not body.selected or len(body.selected) > MAX_CHANNELS or len(set(body.selected)) != len(body.selected):
        raise err(400, "Seleção inválida.")
    model = preview(await fetch_template(code_of(body.template)))
    if model["fingerprint"] != body.fingerprint:
        raise err(409, "O modelo mudou. Confira a prévia novamente.")
    by_id = {c["id"]: c for c in model["channels"]}
    if any(i not in by_id or by_id[i]["private"] for i in body.selected):
        raise err(400, "Seleção contém canal privado ou desconhecido.")
    selected = [c for c in model["channels"] if c["id"] in body.selected]
    normalized = [(c, clean_channel_name(c["name"], c["type"])) for c in selected]
    if len({(c["type"], name) for c, name in normalized}) != len(normalized):
        raise err(400, "O modelo contém canais com nomes duplicados.")
    async with pool().acquire() as conn:
        async with conn.transaction():
            await conn.execute("SELECT pg_advisory_xact_lock($1)", server)
            role = await conn.fetchval("SELECT role FROM members WHERE server_id = $1 AND user_id = $2", server, me.id)
            if role not in ("owner", "admin"):
                raise err(403, "Só admins podem fazer isso.")
            existing = await conn.fetch("SELECT id, name, type, position, view_roles, send_roles FROM channels WHERE server_id = $1 ORDER BY position", server)
            if body.mode == "replace" and existing:
                if any(r["view_roles"] or r["send_roles"] for r in existing):
                    raise err(409, "Há canais com permissões próprias. Preserve a configuração antes de substituir.")
                ids = [r["id"] for r in existing]
                # Exclusão só é segura quando nenhum canal possui dados ou vínculos.
                for table, field in (("messages", "channel_id"), ("read_states", "channel_id"), ("queue_items", "channel_id"), ("webhooks", "channel_id"), ("discord_links", "channel_id"), ("server_events", "voice_channel_id"), ("server_events", "text_channel_id")):
                    if await conn.fetchval(f"SELECT 1 FROM {table} WHERE {field} = ANY($1::bigint[]) LIMIT 1", ids):
                        raise err(409, "Há canais com mensagens, eventos ou vínculos. Preserve os dados antes de substituir.")
                await conn.execute("DELETE FROM channels WHERE server_id = $1", server)
                existing = []
            names = {(r["type"], r["name"]) for r in existing}
            position = max((r["position"] for r in existing), default=-1) + 1
            created = 0
            for channel, name in normalized:
                key = (channel["type"], name)
                if key in names:
                    continue
                await conn.execute(
                    "INSERT INTO channels (id, server_id, type, name, position, user_limit) VALUES ($1,$2,$3,$4,$5,$6)",
                    new_id(), server, channel["type"], name, position, channel["user_limit"],
                )
                names.add(key)
                position += 1
                created += 1
    await announce_server(server)
    return {"created": created, "selected": len(selected), "skipped": len(selected) - created}
