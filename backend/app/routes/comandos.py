"""Comandos com barra no chat: os da casa (/dado, /moeda, /sortear…) e os dos bots da turma.

Um bot (webhook) pode ter comandos e um endereço de comandos. Quando alguém digita "/clima sp" no servidor,
a API manda um POST para esse endereço com o comando, e o que o bot responder vira mensagem do bot no canal.
"""

from __future__ import annotations

import asyncio
import hashlib
import hmac
import json
import random
import re
import time
from collections import deque
from typing import Any
from fastapi import APIRouter
from pydantic import BaseModel

from ..core import Auth, CurrentUser, err, parse_id, pool, sid
from ..outbound import post_public_https, public_https_target
from ..realtime import can_access_channel, hub

router = APIRouter()

# mensagens dos comandos da casa saem com este "bot"
HOUSE_BOT_ID = 1
HOUSE_BOT_NAME = "Call dos Games"
NAME_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{0,23}$")

BUILTIN: dict[str, str] = {
    "dado": "Rola dados. Ex.: /dado, /dado 2d6, /dado d20",
    "moeda": "Cara ou coroa",
    "sortear": "Sorteia alguém da sua call (ou entre opções: /sortear pizza, hambúrguer)",
    "escolher": "Escolhe uma das opções: /escolher a, b, c",
    "ajuda": "Lista os comandos deste canal",
}

_rng = random.SystemRandom()
_hits: dict[int, deque[float]] = {}


def parse_command(content: str) -> tuple[str, str] | None:
    m = re.match(r"^/([a-zA-Z0-9_-]{1,24})(?:\s+(.*))?$", content.strip(), re.S)
    if not m:
        return None
    return m.group(1).lower(), (m.group(2) or "").strip()


async def server_bots(server_id: int | None) -> list[dict]:
    if server_id is None:
        return []
    rows = await pool().fetch(
        """SELECT w.id, w.name, w.commands, w.command_url, w.token_hash FROM webhooks w
           JOIN channels c ON c.id = w.channel_id WHERE c.server_id = $1 AND w.command_url <> '' AND cardinality(w.commands) > 0""",
        server_id,
    )
    return [dict(r) for r in rows]


MODULE_HELP: dict[str, str] = {
    "tocar": "Põe uma música na fila da sua call: /tocar nome ou link",
    "fila": "Mostra a fila de músicas da sua call",
    "pular": "Pula a música (a sua) ou vota para pular",
    "radio": "Liga/desliga o rádio da call: quando a fila acaba, entra música na mesma vibe",
    "enquete": "Enquete: /enquete pergunta | opção 1 | opção 2",
    "jogo": "Procura um jogo na Steam: /jogo nome",
    "gratis": "Jogos grátis para resgatar na Steam agora",
}


def resolve(name: str) -> str:
    from .bots import ALIASES

    return ALIASES.get(name, name)


def is_private_command(content: str) -> bool:
    """Comando de música e /ajuda: só quem digitou vê (e some em 12 h)."""
    parsed = parse_command(content)
    return bool(parsed) and resolve(parsed[0]) in ("tocar", "fila", "pular", "radio", "ajuda")


async def gate(name: str, ch: dict, user_id: int) -> tuple[Any, Any, str | None]:
    """(módulo ativo, quem é a pessoa, motivo de não poder). Módulo None = não é comando de módulo."""
    from ..perms import member as perms_member
    from .bots import COMMAND_MODULE, active

    key = COMMAND_MODULE.get(name)
    if not key:
        return None, None, None
    mod = await active(ch.get("server_id"), key)
    who = await perms_member(ch["server_id"], user_id) if ch.get("server_id") is not None else None
    if not mod:
        return None, who, f"/{name} está desligado neste servidor."
    if not mod.in_channel(ch["id"]):
        return mod, who, f"/{name} não funciona neste canal."
    if ch.get("server_id") is not None:
        perm = "musica" if key == "musica" else "comandos"
        if not (who and who.can(perm)) or not mod.allows(who):
            return mod, who, f"Seu cargo não pode usar /{name} aqui."
    return mod, who, None


@router.get("/channels/{channel_id}/commands")
async def list_commands(channel_id: str, me: Auth = CurrentUser) -> list[dict]:
    """Para o autocompletar do chat."""
    from .bots import COMMAND_MODULE

    ch = await can_access_channel(me.id, parse_id(channel_id))
    if not ch:
        raise err(404, "Canal não encontrado.")
    out = [{"name": "ajuda", "description": BUILTIN["ajuda"], "bot": HOUSE_BOT_NAME}]
    for n in COMMAND_MODULE:
        mod, _who, why = await gate(n, ch, me.id)
        if mod and not why:
            out.append({"name": n, "description": BUILTIN.get(n) or MODULE_HELP.get(n, ""), "bot": mod.bot_name})
    taken = set(BUILTIN) | set(COMMAND_MODULE)
    for b in await server_bots(ch.get("server_id")):
        for c in b["commands"]:
            if c not in taken:
                taken.add(c)
                out.append({"name": c, "description": f"Comando do bot {b['name']}", "bot": b["name"]})
    return out


# ------------------------------------------------------------------ os da casa
async def names_of(ids: list[int]) -> list[str]:
    rows = await pool().fetch("SELECT id, display_name FROM users WHERE id = ANY($1::bigint[])", ids)
    by = {r["id"]: r["display_name"] for r in rows}
    return [by[i] for i in ids if i in by]


def split_options(args: str) -> list[str]:
    sep = "," if "," in args else ";" if ";" in args else " ou " if " ou " in args else None
    opts = [o.strip() for o in (args.split(sep) if sep else [args])]
    return [o[:100] for o in opts if o][:30]


async def builtin_reply(name: str, args: str, ch: dict, user_id: int, me_name: str) -> str | None:
    if name == "moeda":
        return f"🪙 {me_name} jogou a moeda: **{_rng.choice(['Cara', 'Coroa'])}**"
    if name == "dado":
        m = re.match(r"^(\d{0,2})\s*d\s*(\d{1,4})$", args.lower()) if args else None
        n, faces = (int(m.group(1) or 1), int(m.group(2))) if m else (1, 6)
        if args and not m and args.isdigit():
            n, faces = 1, int(args)
        if not (1 <= n <= 20 and 2 <= faces <= 1000):
            return "🎲 Dado inválido. Use até 20 dados de 2 a 1000 lados, tipo /dado 2d6."
        rolls = [_rng.randint(1, faces) for _ in range(n)]
        detail = f"{' + '.join(map(str, rolls))} = **{sum(rolls)}**" if n > 1 else f"**{rolls[0]}**"
        return f"🎲 {me_name} rolou {n}d{faces}: {detail}"
    if name in ("sortear", "escolher"):
        opts = split_options(args) if args else []
        if len(opts) >= 2:
            return f"🎯 Entre {', '.join(opts)}… deu **{_rng.choice(opts)}**!"
        if name == "escolher":
            return "🎯 Me passe pelo menos duas opções: /escolher a, b, c"
        # sem opções: sorteia quem está na call com você (ou quem está online no servidor/conversa)
        vc = hub.user_voice.get(user_id)
        people = list(hub.voice.get(vc, {}).keys()) if vc else []
        where = "da call"
        if len(people) < 2:
            if ch.get("server_id") is not None:
                rows = await pool().fetch("SELECT user_id FROM members WHERE server_id = $1", ch["server_id"])
            else:
                rows = await pool().fetch("SELECT user_id FROM dm_participants WHERE channel_id = $1", ch["id"])
            people = [r["user_id"] for r in rows if hub.online(r["user_id"])]
            where = "de quem está online"
        names = await names_of(people)
        if len(names) < 2:
            return "🎯 Preciso de pelo menos duas pessoas (ou opções: /sortear a, b, c)."
        return f"🎯 Sorteio {where} ({len(names)} pessoas): **{_rng.choice(names)}**!"
    return None


# ------------------------------------------------------------------ os dos bots
def hook_content(body: Any) -> tuple[str, str]:
    """Mesmo formato básico do Discord: content + embeds simples (viram texto) + username."""
    if isinstance(body, str):
        return body.strip()[:4000], ""
    if not isinstance(body, dict):
        return "", ""
    content = str(body.get("content") or "").strip()
    for e in (body.get("embeds") or [])[:5] if isinstance(body.get("embeds"), list) else []:
        if isinstance(e, dict):
            parts = [str(e.get(k) or "").strip() for k in ("title", "description", "url")]
            content += ("\n" if content else "") + "\n".join(p for p in parts if p)
    return content[:4000], str(body.get("username") or "").strip()[:40]


async def call_bot(bot: dict, name: str, args: str, ch: dict, user_id: int, me_name: str, message_id: str) -> tuple[str, str]:
    url = bot["command_url"]
    payload = json.dumps(
        {
            "type": "command",
            "command": name,
            "args": args,
            "user": {"id": sid(user_id), "name": me_name},
            "channel_id": sid(ch["id"]),
            "server_id": sid(ch["server_id"]) if ch.get("server_id") is not None else None,
            "message_id": message_id,
            "timestamp": int(time.time()),
        }
    ).encode()
    # assinatura: HMAC-SHA256 do corpo, com chave = sha256 do token do webhook (o bot sabe o token)
    sig = hmac.new(bot["token_hash"].encode(), payload, hashlib.sha256).hexdigest()
    try:
        r = await asyncio.to_thread(
            post_public_https,
            url,
            payload,
            {"Content-Type": "application/json", "X-CDG-Signature": f"sha256={sig}", "User-Agent": "CallDosGames-Bot/1"},
        )
    except ValueError:
        return f"⚠️ O endereço de comandos do bot {bot['name']} não é aceito (precisa ser HTTPS público).", HOUSE_BOT_NAME
    except (OSError, TimeoutError):
        return f"⚠️ O bot {bot['name']} não respondeu.", HOUSE_BOT_NAME
    if r.status == 204 or not r.content:
        return "", ""  # o bot vai responder depois pelo webhook, se quiser
    if r.status >= 300:
        return f"⚠️ O bot {bot['name']} deu erro ({r.status}).", HOUSE_BOT_NAME
    try:
        body = r.json() if len(r.content) <= 64 * 1024 else None
    except Exception:
        body = r.text[:4000]
    return hook_content(body)


async def run_command(ch: dict, user_id: int, content: str, message_id: str) -> None:
    """Roda depois que a mensagem com o comando já foi postada (não atrasa o envio)."""
    parsed = parse_command(content)
    if not parsed:
        return
    name, args = parsed
    q = _hits.setdefault(user_id, deque())
    now = time.monotonic()
    while q and now - q[0] > 30:
        q.popleft()
    if len(q) >= 10:
        return  # comando demais em pouco tempo: ignora calado
    q.append(now)
    from .bots import COMMAND_MODULE
    from .messages import post_webhook_message  # aqui para não dar ciclo
    from .musica import music_command

    name = resolve(name)
    me_name = await pool().fetchval("SELECT display_name FROM users WHERE id = $1", user_id) or "Alguém"
    try:
        if name == "ajuda":
            lines = []
            for n in COMMAND_MODULE:
                mod, _who, why = await gate(n, ch, user_id)
                if mod and not why:
                    lines.append(f"/{n}: {BUILTIN.get(n) or MODULE_HELP.get(n, '')}")
            for b in await server_bots(ch.get("server_id")):
                lines += [f"/{c}: bot {b['name']}" for c in b["commands"] if c not in BUILTIN and c not in COMMAND_MODULE]
            text = "Comandos deste canal:\n" + "\n".join(lines) if lines else "Nenhum comando liberado neste canal."
            await post_webhook_message(ch["id"], HOUSE_BOT_ID, HOUSE_BOT_NAME, text, visible_to=user_id)
            return
        if name in COMMAND_MODULE:
            mod, who, why = await gate(name, ch, user_id)
            private = COMMAND_MODULE[name] == "musica"
            if why:
                await post_webhook_message(ch["id"], HOUSE_BOT_ID, HOUSE_BOT_NAME, "🔒 " + why, visible_to=user_id)
                return
            if COMMAND_MODULE[name] == "musica":
                text = await music_command(name, args, ch, user_id, who)
            elif COMMAND_MODULE[name] == "jogos":
                from .jogos import free_games_text, game_search

                text = await game_search(args) if name == "jogo" else await free_games_text()
            elif name == "enquete":
                parts = [p.strip()[:120] for p in args.split("|") if p.strip()]
                if len(parts) < 3:
                    text = "📊 Use assim: /enquete pergunta | opção 1 | opção 2 (até 10 opções)"
                    private = True
                else:
                    nums = ["1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣", "6️⃣", "7️⃣", "8️⃣", "9️⃣", "🔟"]
                    opts = "\n".join(f"{nums[i]} {o}" for i, o in enumerate(parts[1:11]))
                    text = f"📊 **{parts[0]}**\n{opts}\nVote reagindo com o número. (enquete de {me_name})"
            else:
                text = await builtin_reply(name, args, ch, user_id, me_name)
            if text:
                await post_webhook_message(ch["id"], mod.bot_id, mod.bot_name, text, visible_to=user_id if private else None)
            return
        bot = next((b for b in await server_bots(ch.get("server_id")) if name in b["commands"]), None)
        if not bot:
            return  # não é comando de ninguém: fica só a mensagem
        if ch.get("server_id") is not None:
            from ..perms import member as perms_member

            who = await perms_member(ch["server_id"], user_id)
            if not (who and who.can("comandos")):
                await post_webhook_message(ch["id"], HOUSE_BOT_ID, HOUSE_BOT_NAME, "🔒 Seu cargo não pode usar comandos de bot aqui.", visible_to=user_id)
                return
        text, as_name = await call_bot(bot, name, args, ch, user_id, me_name, message_id)
        if text:
            wid = HOUSE_BOT_ID if as_name == HOUSE_BOT_NAME else bot["id"]
            await post_webhook_message(ch["id"], wid, as_name or bot["name"], text)
    except Exception:
        pass


# ------------------------------------------------------------------ configurar os comandos de um bot
class BotCommandsIn(BaseModel):
    command_url: str = ""
    commands: list[str] = []


@router.patch("/webhooks/{webhook_id}")
async def set_bot_commands(webhook_id: str, body: BotCommandsIn, me: Auth = CurrentUser) -> dict:
    from .extras2 import _text_channel_admin

    wid = parse_id(webhook_id)
    cid = await pool().fetchval("SELECT channel_id FROM webhooks WHERE id = $1", wid)
    if not cid:
        raise err(404, "Webhook não encontrado.")
    await _text_channel_admin(cid, me.id)
    url = body.command_url.strip()[:500]
    if url:
        try:
            await asyncio.to_thread(public_https_target, url)
        except ValueError:
            raise err(400, "O endereço de comandos precisa ser HTTPS público na porta 443.")
    names: list[str] = []
    for c in body.commands[:20]:
        c = c.strip().lstrip("/").lower()
        if not c:
            continue
        if not NAME_RE.match(c):
            raise err(400, f"Comando inválido: {c} (use letras minúsculas, números, - ou _).")
        if c in BUILTIN or c in MODULE_HELP or c in ("play", "p", "skip", "queue", "poll"):
            raise err(400, f"/{c} já é um comando da casa.")
        if c not in names:
            names.append(c)
    await pool().execute("UPDATE webhooks SET command_url = $1, commands = $2 WHERE id = $3", url, names, wid)
    return {"id": sid(wid), "command_url": url, "commands": names}
