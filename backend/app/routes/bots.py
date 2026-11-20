"""Bots da turma, montados sem código: cada bot junta módulos prontos (música, diversão, boas-vindas…).

Cada módulo tem "enabled" e, quando faz sentido, "channels" (em quais canais de texto funciona; vazio = todos)
e "roles" (quais cargos podem usar; vazio = todo mundo que tem a permissão do servidor).
Se nenhum bot do servidor configurou um módulo, valem os padrões da casa: música, diversão e enquete ligados
para todos; o resto desligado.
"""

from __future__ import annotations

import asyncio
import json
import re
import time
from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import APIRouter
from pydantic import BaseModel

from ..core import Auth, CurrentUser, err, new_id, parse_id, pool, sid
from ..perms import Member
from .servers import HEX_RE, require_admin

router = APIRouter()

HOUSE_BOT_ID = 1
HOUSE_BOT_NAME = "Call dos Games"
MAX_BOTS = 10
# o Brasil não tem horário de verão desde 2019: os lembretes usam o horário de Brasília
BRT = timezone(timedelta(hours=-3))

MODULES: dict[str, dict[str, Any]] = {
    "musica": {"label": "Música", "commands": ["tocar", "fila", "pular", "radio"], "house": True},
    "diversao": {"label": "Diversão", "commands": ["dado", "moeda", "sortear", "escolher"], "house": True},
    "enquete": {"label": "Enquete", "commands": ["enquete"], "house": True},
    "jogos": {"label": "Jogos", "commands": ["jogo", "gratis"], "house": True},
    "boas_vindas": {"label": "Boas-vindas", "commands": [], "house": False},
    "auto_resposta": {"label": "Respostas automáticas", "commands": [], "house": False},
    "filtro": {"label": "Filtro de palavras", "commands": [], "house": False},
    "lembretes": {"label": "Lembretes", "commands": [], "house": False},
    "cargo_automatico": {"label": "Cargo automático", "commands": [], "house": False},
}
COMMAND_MODULE = {c: k for k, m in MODULES.items() for c in m["commands"]}
# apelidos que também valem
ALIASES = {"play": "tocar", "p": "tocar", "skip": "pular", "autoplay": "radio", "rádio": "radio", "queue": "fila", "poll": "enquete", "game": "jogo", "steam": "jogo", "free": "gratis", "grátis": "gratis"}


# ------------------------------------------------------------------ cache dos bots por servidor
_cache: dict[int, tuple[float, list[dict]]] = {}


async def bots_of(server_id: int) -> list[dict]:
    hit = _cache.get(server_id)
    if hit and time.monotonic() - hit[0] < 30:
        return hit[1]
    rows = await pool().fetch("SELECT id, name, color, modules FROM server_bots WHERE server_id = $1 ORDER BY created_at, id", server_id)
    bots = [{"id": r["id"], "name": r["name"], "color": r["color"], "modules": json.loads(r["modules"]) if isinstance(r["modules"], str) else dict(r["modules"])} for r in rows]
    _cache[server_id] = (time.monotonic(), bots)
    return bots


class Active:
    """Um módulo ligado: qual bot fala por ele e a configuração."""

    def __init__(self, key: str, bot_id: int, bot_name: str, cfg: dict):
        self.key, self.bot_id, self.bot_name, self.cfg = key, bot_id, bot_name, cfg

    def in_channel(self, channel_id: int) -> bool:
        chans = self.cfg.get("channels") or []
        return not chans or sid(channel_id) in chans

    def allows(self, m: Member | None) -> bool:
        roles = self.cfg.get("roles") or []
        if not roles or (m and m.admin):
            return True
        return bool(m and {int(r) for r in roles} & m.role_ids)


async def active(server_id: int | None, key: str) -> Active | None:
    """O módulo vale neste servidor? Conversa direta: só os da casa."""
    house = Active(key, HOUSE_BOT_ID, HOUSE_BOT_NAME, {"enabled": True}) if MODULES[key]["house"] else None
    if server_id is None:
        return house
    for b in await bots_of(server_id):
        cfg = b["modules"].get(key)
        if isinstance(cfg, dict):
            return Active(key, b["id"], b["name"], cfg) if cfg.get("enabled") else None
    return house


# ------------------------------------------------------------------ validação da configuração
def _ids(raw: Any, limit: int = 50) -> list[str]:
    if not isinstance(raw, list):
        return []
    out: list[str] = []
    for x in raw[:limit]:
        try:
            out.append(sid(parse_id(str(x))))  # type: ignore[arg-type]
        except Exception:
            continue
    return list(dict.fromkeys(out))


def _text(raw: Any, n: int) -> str:
    return str(raw or "").strip()[:n]


async def clean_modules(server_id: int, raw: dict) -> dict:
    text_channels = {sid(r["id"]) for r in await pool().fetch("SELECT id FROM channels WHERE server_id = $1 AND type = 'text'", server_id)}
    roles = {sid(r["id"]) for r in await pool().fetch("SELECT id FROM roles WHERE server_id = $1", server_id)}
    out: dict[str, dict] = {}
    for key, cfg in (raw or {}).items():
        if key not in MODULES or not isinstance(cfg, dict):
            continue
        c: dict[str, Any] = {"enabled": bool(cfg.get("enabled"))}
        if key in ("musica", "diversao", "enquete", "jogos", "auto_resposta", "filtro"):
            c["channels"] = [x for x in _ids(cfg.get("channels")) if x in text_channels]
        if key in ("musica", "diversao", "enquete", "jogos"):
            c["roles"] = [x for x in _ids(cfg.get("roles")) if x in roles]
        if key == "boas_vindas":
            ch = _ids([cfg.get("channel")]) if cfg.get("channel") else []
            c["channel"] = ch[0] if ch and ch[0] in text_channels else None
            c["text"] = _text(cfg.get("text"), 500) or "Chegou {nome}! Bem-vindo(a) ao {servidor} 🎉"
        if key == "auto_resposta":
            rules = []
            for r in (cfg.get("rules") or [])[:30]:
                if isinstance(r, dict) and _text(r.get("trigger"), 60) and _text(r.get("reply"), 1000):
                    rules.append({"trigger": _text(r.get("trigger"), 60), "reply": _text(r.get("reply"), 1000), "exact": bool(r.get("exact"))})
            c["rules"] = rules
        if key == "filtro":
            words = [_text(w, 40).lower() for w in (cfg.get("words") or [])[:100] if _text(w, 40)]
            c["words"] = list(dict.fromkeys(words))
            c["warning"] = _text(cfg.get("warning"), 200) or "Sua mensagem foi apagada: tem uma palavra que não pode aqui."
        if key == "lembretes":
            items = []
            for it in (cfg.get("items") or [])[:20]:
                if not isinstance(it, dict):
                    continue
                ch = _ids([it.get("channel")])
                hhmm = _text(it.get("time"), 5)
                days = sorted({int(d) for d in (it.get("days") or []) if str(d).isdigit() and 0 <= int(d) <= 6})
                if not ch or ch[0] not in text_channels or not re.match(r"^([01]\d|2[0-3]):[0-5]\d$", hhmm) or not _text(it.get("text"), 1000):
                    continue
                items.append({"channel": ch[0], "time": hhmm, "days": days or list(range(7)), "text": _text(it.get("text"), 1000)})
            c["items"] = items
        if key == "jogos":
            # canal onde o bot avisa sozinho os jogos grátis novos da Steam (None = só pelo /gratis)
            ch = _ids([cfg.get("aviso")]) if cfg.get("aviso") else []
            c["aviso"] = ch[0] if ch and ch[0] in text_channels else None
        if key == "cargo_automatico":
            c["roles"] = [x for x in _ids(cfg.get("roles")) if x in roles]
        out[key] = c
    return out


# ------------------------------------------------------------------ rotas
def bot_out(r: Any) -> dict:
    mods = json.loads(r["modules"]) if isinstance(r["modules"], str) else dict(r["modules"])
    return {"id": sid(r["id"]), "name": r["name"], "color": r["color"], "modules": mods}


@router.get("/servers/{server_id}/bots")
async def list_bots(server_id: str, me: Auth = CurrentUser) -> dict:
    s = parse_id(server_id)
    await require_admin(s, me.id)
    rows = await pool().fetch("SELECT * FROM server_bots WHERE server_id = $1 ORDER BY created_at, id", s)
    return {
        "bots": [bot_out(r) for r in rows],
        "modules": [{"key": k, "label": m["label"], "commands": m["commands"], "house": m["house"]} for k, m in MODULES.items()],
    }


class BotIn(BaseModel):
    name: str | None = None
    color: str | None = None
    modules: dict | None = None


@router.post("/servers/{server_id}/bots")
async def create_bot(server_id: str, body: BotIn, me: Auth = CurrentUser) -> dict:
    s = parse_id(server_id)
    await require_admin(s, me.id)
    if await pool().fetchval("SELECT count(*) FROM server_bots WHERE server_id = $1", s) >= MAX_BOTS:
        raise err(400, f"Limite de {MAX_BOTS} bots por servidor.")
    name = _text(body.name, 32)
    if not name:
        raise err(400, "Dê um nome para o bot.")
    color = (body.color or "#5865f2").lower()
    if not HEX_RE.match(color):
        raise err(400, "Cor inválida.")
    bid = new_id()
    mods = await clean_modules(s, body.modules or {})
    await pool().execute("INSERT INTO server_bots (id, server_id, name, color, modules) VALUES ($1,$2,$3,$4,$5::jsonb)", bid, s, name, color, json.dumps(mods))
    _cache.pop(s, None)
    return bot_out(await pool().fetchrow("SELECT * FROM server_bots WHERE id = $1", bid))


async def _bot(bot_id: str, me: int) -> Any:
    row = await pool().fetchrow("SELECT * FROM server_bots WHERE id = $1", parse_id(bot_id))
    if not row:
        raise err(404, "Bot não encontrado.")
    await require_admin(row["server_id"], me)
    return row


@router.patch("/bots/{bot_id}")
async def update_bot(bot_id: str, body: BotIn, me: Auth = CurrentUser) -> dict:
    row = await _bot(bot_id, me.id)
    if body.name is not None:
        name = _text(body.name, 32)
        if not name:
            raise err(400, "O nome não pode ficar vazio.")
        await pool().execute("UPDATE server_bots SET name = $1 WHERE id = $2", name, row["id"])
    if body.color is not None:
        if not HEX_RE.match(body.color):
            raise err(400, "Cor inválida.")
        await pool().execute("UPDATE server_bots SET color = $1 WHERE id = $2", body.color.lower(), row["id"])
    if body.modules is not None:
        mods = await clean_modules(row["server_id"], body.modules)
        await pool().execute("UPDATE server_bots SET modules = $1::jsonb WHERE id = $2", json.dumps(mods), row["id"])
    _cache.pop(row["server_id"], None)
    return bot_out(await pool().fetchrow("SELECT * FROM server_bots WHERE id = $1", row["id"]))


@router.delete("/bots/{bot_id}")
async def delete_bot(bot_id: str, me: Auth = CurrentUser) -> dict:
    row = await _bot(bot_id, me.id)
    await pool().execute("DELETE FROM server_bots WHERE id = $1", row["id"])
    _cache.pop(row["server_id"], None)
    return {"ok": True}


# ------------------------------------------------------------------ o que os módulos fazem sozinhos
_last_auto: dict[tuple[int, str], float] = {}


def _has_word(text: str, word: str) -> bool:
    return re.search(rf"(?<![\w]){re.escape(word)}(?![\w])", text, re.I) is not None


async def on_message(ch: dict, user_id: int, content: str, message_id: int) -> None:
    """Toda mensagem normal num canal de texto de servidor: filtro e respostas automáticas."""
    from .messages import emit, post_webhook_message

    s = ch["server_id"]
    try:
        f = await active(s, "filtro")
        if f and f.in_channel(ch["id"]) and any(_has_word(content, w) for w in f.cfg.get("words") or []):
            await pool().execute("DELETE FROM messages WHERE id = $1", message_id)
            await emit(ch["id"], None, "message_delete", {"id": sid(message_id), "channel_id": sid(ch["id"])})
            await post_webhook_message(ch["id"], f.bot_id, f.bot_name, "🚫 " + f.cfg.get("warning", ""), visible_to=user_id)
            return
        a = await active(s, "auto_resposta")
        if a and a.in_channel(ch["id"]):
            low = content.strip().lower()
            for rule in a.cfg.get("rules") or []:
                trig = rule["trigger"].lower()
                hit = low == trig if rule.get("exact") else _has_word(low, trig)
                if not hit:
                    continue
                key = (ch["id"], trig)
                if time.monotonic() - _last_auto.get(key, 0) < 20:  # não vira metralhadora
                    return
                _last_auto[key] = time.monotonic()
                name = await pool().fetchval("SELECT display_name FROM users WHERE id = $1", user_id) or "alguém"
                await post_webhook_message(ch["id"], a.bot_id, a.bot_name, rule["reply"].replace("{nome}", name))
                return
    except Exception:
        pass


async def on_join(server_id: int, user_id: int) -> None:
    """Alguém entrou no servidor: cargo automático e recado de boas-vindas."""
    from .messages import post_webhook_message

    try:
        c = await active(server_id, "cargo_automatico")
        if c:
            ids = [int(r) for r in c.cfg.get("roles") or []]
            for rid in ids:
                await pool().execute(
                    """INSERT INTO member_roles (server_id, user_id, role_id)
                       SELECT $1, $2, id FROM roles WHERE id = $3 AND server_id = $1 ON CONFLICT DO NOTHING""",
                    server_id, user_id, rid,
                )
        w = await active(server_id, "boas_vindas")
        if w and w.cfg.get("channel"):
            name = await pool().fetchval("SELECT display_name FROM users WHERE id = $1", user_id) or "alguém"
            server = await pool().fetchval("SELECT name FROM servers WHERE id = $1", server_id) or ""
            text = w.cfg.get("text", "").replace("{nome}", name).replace("{servidor}", server)
            await post_webhook_message(int(w.cfg["channel"]), w.bot_id, w.bot_name, text)
    except Exception:
        pass


_fired: set[str] = set()


async def reminder_loop() -> None:
    """Lembretes agendados (horário de Brasília). Confere a cada 20 s."""
    from .messages import post_webhook_message

    while True:
        try:
            now = datetime.now(BRT)
            hhmm, day, stamp = now.strftime("%H:%M"), (now.weekday() + 1) % 7, now.strftime("%Y-%m-%d %H:%M")  # 0 = domingo
            rows = await pool().fetch("SELECT id, server_id, name, modules FROM server_bots WHERE modules ? 'lembretes'")
        
            for r in rows:
                mods = json.loads(r["modules"]) if isinstance(r["modules"], str) else dict(r["modules"])
                cfg = mods.get("lembretes") or {}
                if not cfg.get("enabled"):
                    continue
                for i, it in enumerate(cfg.get("items") or []):
                    key = f"{r['id']}:{i}:{stamp}"
                    if it.get("time") == hhmm and day in (it.get("days") or []) and key not in _fired:
                        _fired.add(key)
                        cid = int(it["channel"])
                        if await pool().fetchval("SELECT 1 FROM channels WHERE id = $1 AND server_id = $2", cid, r["server_id"]):
                            await post_webhook_message(cid, r["id"], r["name"], "⏰ " + it["text"])
            if len(_fired) > 5000:
                _fired.clear()
        except asyncio.CancelledError:
            raise
        except Exception:
            pass
        await asyncio.sleep(20)

