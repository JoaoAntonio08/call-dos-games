"""Ponte com o Discord: um canal de texto daqui fica espelhado com um canal do Discord, nos dois sentidos.

Como funciona:
- Um bot do Discord (token em DISCORD_BOT_TOKEN) fica conectado no gateway e lê as mensagens dos canais ligados.
- Mensagem nova lá → aparece aqui com o nome e a foto de quem mandou (e as imagens/GIFs).
- Mensagem nova aqui → vai para lá por um webhook que o bot cria no canal, com o seu nome e a sua foto.
- Para ligar: um admin do servidor daqui gera um código e alguém que administra o Discord digita
  `!ponte CÓDIGO` no canal de lá. Assim ninguém espelha um canal do Discord que não administra.
- Canal de voz: o código é digitado no chat do canal de voz do Discord. Daí quem está na call de lá
  aparece aqui, e o serviço ponte-voz (Node, à parte) leva o áudio entre as duas calls.
"""

from __future__ import annotations

import asyncio
import tempfile
import json
import logging
import random
import re
import secrets
import time
from typing import Any
from urllib.parse import urlparse

import httpx
import websockets
from fastapi import APIRouter, Header, HTTPException, Request, UploadFile

from ..core import Auth, CurrentUser, env, err, parse_id, pool, settings, sid
from ..files import save_upload
from .servers import require_admin
from ..realtime import hub

router = APIRouter()
log = logging.getLogger("cdg.discord")

TOKEN = env("DISCORD_BOT_TOKEN")
# só para laboratório (Discord de mentira nos testes); em produção fica o oficial
API = env("DISCORD_API_BASE", "https://discord.com/api/v10").rstrip("/")
CDN_HOSTS = {"cdn.discordapp.com", "media.discordapp.net", urlparse(API).hostname or ""}
# imagens de cartões (embeds) de sites de fora passam pelo proxy do Discord nestes endereços
PROXY_HOSTS = frozenset({"images-ext-1.discordapp.net", "images-ext-2.discordapp.net"})
MAX_EMBEDS = 4
# figurinha do Discord: 1 PNG, 2 APNG, 4 GIF (3 é Lottie, que não dá para mostrar como imagem)
STICKER_EXT = {1: "png", 2: "png", 4: "gif"}

# o que o bot precisa receber: servidores, quem está nas calls, mensagens e o texto delas
# (ligar "Message Content Intent" no portal; as outras não precisam de liberação)
INTENTS = (1 << 0) | (1 << 7) | (1 << 9) | (1 << 15)
# permissões do convite: ver canais, mandar mensagem, links, arquivos, histórico, gerenciar webhooks,
# e na voz: conectar, falar e usar detecção de voz
PERMS = 1024 | 2048 | 16384 | 32768 | 65536 | 536870912 | 1048576 | 2097152 | 33554432
# segredo que o serviço ponte-voz manda para ler as ligações de voz (só pela própria máquina)
VOICE_SECRET = env("DISCORD_VOICE_SECRET")
DISCORD_VOICE_TYPES = (2,)  # canal de voz comum
ADMIN_BITS = 8 | 16 | 32  # Administrador, Gerenciar canais, Gerenciar servidor

MAX_FILE = 10 * 1024 * 1024  # webhook do Discord sem impulso aceita até 10 MB
MAX_FILES = 5
WORKERS = 2
QUEUE_CAPACITY = 16
JOB_TIMEOUT = 60
CODE_TTL = 600


class _Fatal(Exception):
    """Erro que não adianta tentar de novo (token errado, intent desligada)."""


class _Ponte:
    def __init__(self) -> None:
        self.status = "ligando" if TOKEN else "desligado"
        self.erro = ""
        self.bot_id = ""
        self.bot_name = ""
        # id do servidor do Discord -> {name, owner_id, roles{id: perms}, channels{id: nome}}
        self.guilds: dict[str, dict] = {}
        self.links: dict[str, dict] = {}  # canal do Discord -> ligação
        self.by_channel: dict[int, dict] = {}  # canal daqui -> ligação
        self.codes: dict[str, tuple[int, int, float, str]] = {}  # código -> (canal daqui, quem gerou, validade, tipo)
        # voz: canal de voz do Discord <-> canal de voz daqui
        self.vlinks: dict[str, dict] = {}
        self.vby_channel: dict[int, dict] = {}
        # quem está nas calls do Discord: servidor -> pessoa -> estado (canal, nome, foto, mudo, sem som, bot)
        self.voice: dict[str, dict[str, dict]] = {}
        self.locks: dict[int, asyncio.Lock] = {}
        self.queue: asyncio.Queue = asyncio.Queue(maxsize=QUEUE_CAPACITY)
        self.workers: list[asyncio.Task] = []
        self.active = 0
        self.dropped = 0

    def submit(self, job: Any, *args: Any) -> None:
        try:
            if self.workers:
                self.queue.put_nowait((job, args))
                return
        except asyncio.QueueFull:
            pass
        self.dropped += 1
        if self.dropped & (self.dropped - 1) == 0:
            log.warning("ponte: ativos=%d fila=%d descartes=%d", self.active, self.queue.qsize(), self.dropped)

    async def work(self) -> None:
        while True:
            job, args = await self.queue.get()
            self.active += 1
            try:
                async with asyncio.timeout(JOB_TIMEOUT):
                    await job(*args)
            except Exception as exc:
                log.warning("ponte: trabalho falhou (%s)", type(exc).__name__)
            finally:
                self.active -= 1
                self.queue.task_done()

    async def stop(self) -> None:
        workers, self.workers = self.workers, []
        for worker in workers:
            worker.cancel()
        await asyncio.gather(*workers, return_exceptions=True)
        while not self.queue.empty():
            self.queue.get_nowait()
            self.queue.task_done()
            self.dropped += 1

    def invite_url(self) -> str:
        if not self.bot_id:
            return ""
        return f"https://discord.com/oauth2/authorize?client_id={self.bot_id}&scope=bot&permissions={PERMS}"

    def put(self, link: dict) -> None:
        old = self.by_channel.get(link["channel_id"])
        if old:
            self.links.pop(old["discord_channel_id"], None)
        self.links[link["discord_channel_id"]] = link
        self.by_channel[link["channel_id"]] = link

    def drop(self, channel_id: int) -> dict | None:
        link = self.by_channel.pop(channel_id, None)
        if link:
            self.links.pop(link["discord_channel_id"], None)
        return link

    def vput(self, link: dict) -> None:
        old = self.vby_channel.get(link["channel_id"])
        if old:
            self.vlinks.pop(old["discord_channel_id"], None)
        self.vlinks[link["discord_channel_id"]] = link
        self.vby_channel[link["channel_id"]] = link

    def vdrop(self, channel_id: int) -> dict | None:
        link = self.vby_channel.pop(channel_id, None)
        if link:
            self.vlinks.pop(link["discord_channel_id"], None)
        return link

    def in_call(self, link: dict) -> list[dict]:
        """Quem está agora no canal de voz do Discord ligado (sem bots)."""
        people = self.voice.get(link["discord_guild_id"], {})
        return [
            {"id": uid, "name": st["name"], "avatar": st["avatar"], "mute": st["mute"], "deaf": st["deaf"]}
            for uid, st in people.items()
            if st["channel_id"] == link["discord_channel_id"] and not st["bot"]
        ]


ponte = _Ponte()


def _bot_headers() -> dict:
    return {"Authorization": f"Bot {TOKEN}", "User-Agent": "DiscordBot (https://call.zapeu.net, 1.0) CallDosGames"}


async def _rest(method: str, path: str, *, bot: bool = True, **kw: Any) -> httpx.Response:
    """Chamada na API do Discord, esperando uma vez se ele pedir calma (429)."""
    async with httpx.AsyncClient(timeout=20) as c:
        for _ in range(2):
            r = await c.request(method, f"{API}{path}", headers=_bot_headers() if bot else {"User-Agent": "CallDosGames"}, **kw)
            if r.status_code != 429:
                return r
            try:
                wait = float(r.json().get("retry_after", 1))
            except Exception:
                wait = 1.0
            await asyncio.sleep(min(wait, 10))
        return r


async def _load_links() -> None:
    rows = await pool().fetch("SELECT * FROM discord_links")
    for r in rows:
        ponte.put(dict(r))
    for r in await pool().fetch("SELECT * FROM discord_voice_links"):
        ponte.vput(dict(r))


# ------------------------------------------------------------------ gateway (Discord → aqui)


async def discord_loop() -> None:
    if not TOKEN:
        return
    try:
        await _load_links()
    except Exception:
        log.exception("ponte: não consegui ler as ligações")
    wait = 2.0
    while True:
        try:
            ponte.workers = [asyncio.create_task(ponte.work()) for _ in range(WORKERS)]
            await _session()
            wait = 2.0
        except asyncio.CancelledError:
            raise
        except _Fatal as e:
            ponte.status, ponte.erro = "erro", str(e)
            log.error("ponte com o Discord parada: %s", e)
            return
        except Exception as e:
            ponte.status, ponte.erro = "reconectando", f"{type(e).__name__}: {e}"[:200]
            log.warning("ponte com o Discord caiu: %s", ponte.erro)
        finally:
            await ponte.stop()
        await asyncio.sleep(wait + random.random())
        wait = min(wait * 2, 120)


def _fatal_close(code: int | None) -> None:
    if code == 4004:
        raise _Fatal("O token do bot está errado (DISCORD_BOT_TOKEN).")
    if code in (4013, 4014):
        raise _Fatal("Ligue “Message Content Intent” na página do bot (Discord Developer Portal → Bot).")


async def _session() -> None:
    r = await _rest("GET", "/gateway/bot")
    if r.status_code == 401:
        raise _Fatal("O token do bot está errado (DISCORD_BOT_TOKEN).")
    r.raise_for_status()
    url = r.json()["url"].rstrip("/")
    state: dict[str, Any] = {"seq": None, "ack": True}
    async with websockets.connect(f"{url}/?v=10&encoding=json", max_size=16 * 1024 * 1024, open_timeout=20) as ws:
        hello = json.loads(await asyncio.wait_for(ws.recv(), 20))
        interval = hello["d"]["heartbeat_interval"] / 1000
        await ws.send(json.dumps({
            "op": 2,
            "d": {"token": TOKEN, "intents": INTENTS, "properties": {"os": "linux", "browser": "call-dos-games", "device": "call-dos-games"}},
        }))
        beat = asyncio.create_task(_heartbeat(ws, interval, state))
        try:
            async for raw in ws:
                p = json.loads(raw)
                if p.get("s") is not None:
                    state["seq"] = p["s"]
                op = p.get("op")
                if op == 0:
                    try:
                        _dispatch(p.get("t") or "", p.get("d") or {})
                    except Exception:
                        log.exception("ponte: evento %s", p.get("t"))
                elif op == 1:
                    await ws.send(json.dumps({"op": 1, "d": state["seq"]}))
                elif op == 11:
                    state["ack"] = True
                elif op == 7:  # o Discord pediu para reconectar
                    return
                elif op == 9:  # sessão inválida: identifica de novo daqui a pouco
                    await asyncio.sleep(1 + random.random() * 4)
                    return
        except websockets.ConnectionClosed as e:
            _fatal_close(e.rcvd.code if e.rcvd else None)
            raise
        finally:
            beat.cancel()
        _fatal_close(ws.close_code)


async def _heartbeat(ws: Any, interval: float, state: dict) -> None:
    await asyncio.sleep(interval * random.random())
    while True:
        if not state["ack"]:  # o Discord não respondeu: conexão zumbi, reconecta
            await ws.close(4000)
            return
        state["ack"] = False
        await ws.send(json.dumps({"op": 1, "d": state["seq"]}))
        await asyncio.sleep(interval)


def _guild_from(d: dict) -> dict:
    return {
        "name": d.get("name") or "",
        "owner_id": str(d.get("owner_id") or ""),
        "roles": {str(r["id"]): int(r.get("permissions") or 0) for r in d.get("roles") or []},
        "channels": {str(c["id"]): c.get("name") or "" for c in d.get("channels") or []},
        "types": {str(c["id"]): int(c.get("type") or 0) for c in d.get("channels") or []},
    }


def _voice_state(gid: str, vs: dict, member: dict | None = None) -> None:
    """Atualiza quem está em qual call do Discord e avisa aqui se mexeu num canal ligado."""
    member = member or vs.get("member") or {}
    user = member.get("user") or vs.get("user") or {}
    uid = str(vs.get("user_id") or user.get("id") or "")
    if not uid:
        return
    people = ponte.voice.setdefault(gid, {})
    old = people.get(uid, {})
    before = old.get("channel_id")
    after = str(vs.get("channel_id") or "")
    if after:
        people[uid] = {
            "channel_id": after,
            "name": _display(user, member) if user else old.get("name", "Alguém"),
            "avatar": _avatar(user, member, gid) if user else old.get("avatar", ""),
            "mute": bool(vs.get("self_mute") or vs.get("mute")),
            "deaf": bool(vs.get("self_deaf") or vs.get("deaf")),
            "bot": bool(user.get("bot")) if user else old.get("bot", False),
        }
    else:
        people.pop(uid, None)
    for ch in {before, after}:
        link = ponte.vlinks.get(ch or "")
        if link:
            _voice_changed(link)


def _voice_changed(link: dict) -> None:
    try:
        asyncio.get_running_loop().create_task(_announce_voice(link))
    except RuntimeError:
        pass  # fora do loop (testes)


async def _announce_voice(link: dict) -> None:
    try:
        await hub.to_channel(link["channel_id"], "discord_voice", {"channel_id": sid(link["channel_id"]), "members": ponte.in_call(link)})
    except Exception:
        log.warning("ponte: não avisei quem está na call do Discord")


def _dispatch(t: str, d: dict) -> None:
    if t == "READY":
        user = d.get("user") or {}
        ponte.bot_id, ponte.bot_name = str(user.get("id") or ""), user.get("username") or ""
        ponte.status, ponte.erro = "ligado", ""
    elif t == "RESUMED":
        ponte.status, ponte.erro = "ligado", ""
    elif t in ("GUILD_CREATE", "GUILD_UPDATE"):
        g = ponte.guilds.get(str(d["id"]), {})
        new = _guild_from(d)
        if t == "GUILD_UPDATE":  # não traz a lista de canais: mantém nomes e tipos que já sabíamos
            new["channels"] = g.get("channels", {})
            new["types"] = g.get("types", {})
        ponte.guilds[str(d["id"])] = new
        if t == "GUILD_CREATE":
            gid = str(d["id"])
            members = {str((m.get("user") or {}).get("id")): m for m in d.get("members") or []}
            ponte.voice[gid] = {}
            for vs in d.get("voice_states") or []:
                _voice_state(gid, vs, members.get(str(vs.get("user_id"))))
            for link in ponte.vlinks.values():
                if link["discord_guild_id"] == gid:
                    _voice_changed(link)
    elif t == "GUILD_DELETE":
        ponte.guilds.pop(str(d.get("id")), None)
        ponte.voice.pop(str(d.get("id")), None)
    elif t == "VOICE_STATE_UPDATE":
        if d.get("guild_id"):
            _voice_state(str(d["guild_id"]), d)
    elif t in ("GUILD_ROLE_CREATE", "GUILD_ROLE_UPDATE"):
        g = ponte.guilds.get(str(d.get("guild_id")))
        if g and d.get("role"):
            g["roles"][str(d["role"]["id"])] = int(d["role"].get("permissions") or 0)
    elif t == "GUILD_ROLE_DELETE":
        g = ponte.guilds.get(str(d.get("guild_id")))
        if g:
            g["roles"].pop(str(d.get("role_id")), None)
    elif t in ("CHANNEL_CREATE", "CHANNEL_UPDATE"):
        g = ponte.guilds.get(str(d.get("guild_id")))
        if g:
            g["channels"][str(d["id"])] = d.get("name") or ""
            g.setdefault("types", {})[str(d["id"])] = int(d.get("type") or 0)
    elif t == "MESSAGE_CREATE":
        if str(d.get("channel_id")) in ponte.links or (d.get("content") or "").lstrip().lower().startswith("!ponte"):
            ponte.submit(_on_discord_message, d)


def _is_discord_admin(d: dict) -> bool:
    g = ponte.guilds.get(str(d.get("guild_id")))
    if not g:
        return False
    author_id = str((d.get("author") or {}).get("id") or "")
    if author_id and author_id == g["owner_id"]:
        return True
    perms = g["roles"].get(str(d.get("guild_id")), 0)  # @everyone tem o id do servidor
    for rid in (d.get("member") or {}).get("roles") or []:
        perms |= g["roles"].get(str(rid), 0)
    return bool(perms & ADMIN_BITS)


async def _reply(d: dict, text: str) -> None:
    await _rest(
        "POST", f"/channels/{d['channel_id']}/messages",
        json={"content": text, "message_reference": {"message_id": d["id"], "fail_if_not_exists": False}, "allowed_mentions": {"parse": []}},
    )


async def _on_discord_message(d: dict) -> None:
    try:
        author = d.get("author") or {}
        if not d.get("guild_id") or str(author.get("id")) == ponte.bot_id:
            return
        content = (d.get("content") or "").strip()
        if content.lower().startswith("!ponte") and not d.get("webhook_id") and not author.get("bot"):
            await _command(d, content[6:].strip())
            return
        link = ponte.links.get(str(d.get("channel_id")))
        if not link or str(d.get("webhook_id") or "") == link["webhook_id"]:
            return  # canal não ligado, ou é a nossa própria mensagem voltando
        if d.get("type", 0) not in (0, 19):  # só mensagem normal e resposta
            return
        await _to_app(link, d)
    except Exception:
        log.exception("ponte: falhou ao trazer mensagem do Discord")


async def _command(d: dict, arg: str) -> None:
    from .messages import post_webhook_message

    dc_channel = str(d["channel_id"])
    if not arg:
        await _reply(d, "Ponte com o Call dos Games: gere um código nas configurações do canal de lá e digite `!ponte CÓDIGO` aqui. Para desligar: `!ponte desligar`.")
        return
    if not _is_discord_admin(d):
        await _reply(d, "Só quem administra este servidor do Discord (ou gerencia canais) pode ligar ou desligar a ponte.")
        return
    if arg.lower() in ("desligar", "parar", "off"):
        vlink = ponte.vlinks.get(dc_channel)
        if vlink:
            await _vunlink(vlink["channel_id"])
            await _reply(d, "Ponte de voz desligada. Esta call não vai mais para o Call dos Games.")
            return
        link = ponte.links.get(dc_channel)
        if not link:
            await _reply(d, "Este canal não está ligado a nenhum canal do Call dos Games.")
            return
        await _unlink(link["channel_id"])
        await _reply(d, "Ponte desligada. As mensagens daqui não vão mais para o Call dos Games.")
        await post_webhook_message(link["channel_id"], link["channel_id"], "Ponte do Discord", "A ponte com o Discord foi desligada pelo lado de lá.")
        return
    code = re.sub(r"[^A-Z0-9]", "", arg.upper())
    got = ponte.codes.get(code)
    if not got or got[2] < time.time():
        await _reply(d, "Código inválido ou vencido. Gere outro nas configurações do canal no Call dos Games.")
        return
    channel_id, user_id, _, kind = got
    if kind == "voice":
        await _link_voice(d, code, channel_id, user_id)
        return
    if ponte.guilds.get(str(d["guild_id"]), {}).get("types", {}).get(dc_channel) in DISCORD_VOICE_TYPES:
        await _reply(d, "Este código é de um canal de texto do Call dos Games. Digite num canal de texto daqui.")
        return
    other = ponte.links.get(dc_channel)
    if other and other["channel_id"] != channel_id:
        await _reply(d, "Este canal já está ligado a outro canal do Call dos Games. Digite `!ponte desligar` primeiro.")
        return
    r = await _rest("POST", f"/channels/{dc_channel}/webhooks", json={"name": "Call dos Games"})
    if r.status_code == 403:
        await _reply(d, "Preciso da permissão “Gerenciar webhooks” neste canal para mandar as mensagens de lá para cá.")
        return
    if r.status_code >= 300:
        await _reply(d, f"O Discord recusou criar o webhook ({r.status_code}). Tente de novo daqui a pouco.")
        return
    hook = r.json()
    ponte.codes.pop(code, None)
    g = ponte.guilds.get(str(d["guild_id"]), {})
    dc_name = g.get("channels", {}).get(dc_channel, "") or "canal"
    old = ponte.by_channel.get(channel_id)
    row = await pool().fetchrow(
        """INSERT INTO discord_links (channel_id, discord_channel_id, discord_guild_id, discord_name, guild_name, webhook_id, webhook_token, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
           ON CONFLICT (channel_id) DO UPDATE SET discord_channel_id = EXCLUDED.discord_channel_id, discord_guild_id = EXCLUDED.discord_guild_id,
             discord_name = EXCLUDED.discord_name, guild_name = EXCLUDED.guild_name, webhook_id = EXCLUDED.webhook_id,
             webhook_token = EXCLUDED.webhook_token, created_by = EXCLUDED.created_by, created_at = now()
           RETURNING *""",
        channel_id, dc_channel, str(d["guild_id"]), dc_name, g.get("name", ""), str(hook["id"]), str(hook["token"]), user_id,
    )
    if old and old["webhook_id"] != str(hook["id"]):
        await _rest("DELETE", f"/webhooks/{old['webhook_id']}/{old['webhook_token']}", bot=False)
    ponte.put(dict(row))
    name = await pool().fetchval("SELECT name FROM channels WHERE id = $1", channel_id) or "canal"
    await _reply(d, f"Pronto! Este canal agora está ligado ao #{name} do Call dos Games. O que for escrito aqui aparece lá, e vice-versa.")
    await post_webhook_message(
        channel_id, channel_id, "Ponte do Discord",
        f"Este canal agora está ligado ao #{dc_name} do Discord ({g.get('name') or 'servidor'}). O que for escrito aqui aparece lá, e vice-versa.",
    )


async def _link_voice(d: dict, code: str, channel_id: int, user_id: int) -> None:
    dc_channel = str(d["channel_id"])
    g = ponte.guilds.get(str(d["guild_id"]), {})
    if g.get("types", {}).get(dc_channel) not in DISCORD_VOICE_TYPES:
        await _reply(d, "Este código é de uma call. Digite no chat do canal de voz do Discord (o balãozinho ao lado do nome da call).")
        return
    other = ponte.vlinks.get(dc_channel)
    if other and other["channel_id"] != channel_id:
        await _reply(d, "Esta call já está ligada a outra call do Call dos Games. Digite `!ponte desligar` primeiro.")
        return
    ponte.codes.pop(code, None)
    dc_name = g.get("channels", {}).get(dc_channel, "") or "call"
    row = await pool().fetchrow(
        """INSERT INTO discord_voice_links (channel_id, discord_channel_id, discord_guild_id, discord_name, guild_name, created_by)
           VALUES ($1,$2,$3,$4,$5,$6)
           ON CONFLICT (channel_id) DO UPDATE SET discord_channel_id = EXCLUDED.discord_channel_id, discord_guild_id = EXCLUDED.discord_guild_id,
             discord_name = EXCLUDED.discord_name, guild_name = EXCLUDED.guild_name, created_by = EXCLUDED.created_by, created_at = now()
           RETURNING *""",
        channel_id, dc_channel, str(d["guild_id"]), dc_name, g.get("name", ""), user_id,
    )
    ponte.vput(dict(row))
    _voice_changed(ponte.vby_channel[channel_id])
    name = await pool().fetchval("SELECT name FROM channels WHERE id = $1", channel_id) or "call"
    await _reply(
        d,
        f"Pronto! Esta call agora está ligada à call {name} do Call dos Games. "
        "Quando tiver gente nas duas, eu entro aqui e passo o áudio de um lado para o outro.",
    )


def _avatar(author: dict, member: dict, guild_id: str) -> str:
    uid = str(author.get("id") or "0")
    if member.get("avatar"):
        h = member["avatar"]
        return f"https://cdn.discordapp.com/guilds/{guild_id}/users/{uid}/avatars/{h}.{'gif' if h.startswith('a_') else 'png'}?size=128"
    if author.get("avatar"):
        h = author["avatar"]
        return f"https://cdn.discordapp.com/avatars/{uid}/{h}.{'gif' if h.startswith('a_') else 'png'}?size=128"
    try:
        n = (int(uid) >> 22) % 6
    except ValueError:
        n = 0
    return f"https://cdn.discordapp.com/embed/avatars/{n}.png"


def _display(author: dict, member: dict) -> str:
    return (member.get("nick") or author.get("global_name") or author.get("username") or "Alguém")[:40]


def _clean_text(text: str, guild_id: Any, names: dict[str, str] | None = None) -> str:
    """Menções do Discord (<@id>, <#id>, <@&id>, <t:...>) viram texto. Emoji próprio (<:nome:id>) fica: o chat mostra a imagem."""
    names = names or {}
    text = re.sub(r"<@!?(\d+)>", lambda m: "@" + names.get(m.group(1), "alguém"), text or "")
    g = ponte.guilds.get(str(guild_id), {})
    text = re.sub(r"<#(\d+)>", lambda m: "#" + (g.get("channels", {}).get(m.group(1)) or "canal"), text)
    text = re.sub(r"<@&\d+>", "@cargo", text)
    text = re.sub(r"<t:(\d{1,12})(?::\w)?>", lambda m: time.strftime("%d/%m/%Y %H:%M", time.localtime(int(m.group(1)))), text)
    return text.strip()


def _clean(d: dict) -> str:
    names = {str(m["id"]): _display(m, m.get("member") or {}) for m in d.get("mentions") or []}
    return _clean_text(d.get("content") or "", d.get("guild_id"), names)


def _http_url(u: Any) -> str:
    u = str(u or "")
    return u[:600] if urlparse(u).scheme in ("http", "https") else ""


def _discord_img(u: Any) -> str:
    """Imagem que dá para mostrar direto: só dos endereços do Discord (o chat não busca imagem em qualquer site)."""
    u = str(u or "")
    p = urlparse(u)
    return u[:600] if p.scheme == "https" and (p.hostname in CDN_HOSTS or p.hostname in PROXY_HOSTS) else ""


async def _embed_image(img: Any, owner: int | None, name: str) -> dict | None:
    """Guarda a imagem do cartão aqui (os links do Discord vencem em ~1 dia); se não der, usa o do Discord."""
    if not isinstance(img, dict):
        return None
    for src in (img.get("url"), img.get("proxy_url")):
        if _discord_img(src):
            got = await _download(str(src), name, owner, extra_hosts=PROXY_HOSTS)
            if got and str(got.get("mime") or "").startswith("image/"):
                return {"file_id": got.get("id"), "url": got.get("url"), "width": img.get("width"), "height": img.get("height")}
    url = _discord_img(img.get("proxy_url")) or _discord_img(img.get("url"))
    return {"url": url, "width": img.get("width"), "height": img.get("height")} if url else None


async def _embeds(d: dict, owner: int | None) -> list[dict]:
    """Os cartões da mensagem do Discord (starboard da Loritta, avisos de bots, prévia de links...)."""
    out: list[dict] = []
    gid = d.get("guild_id")
    for e in (d.get("embeds") or [])[:MAX_EMBEDS]:
        if not isinstance(e, dict):
            continue
        color = e.get("color")
        author = e.get("author") if isinstance(e.get("author"), dict) else {}
        footer = e.get("footer") if isinstance(e.get("footer"), dict) else {}
        provider = e.get("provider") if isinstance(e.get("provider"), dict) else {}
        card = {
            "color": f"#{color:06x}" if isinstance(color, int) and 0 <= color <= 0xFFFFFF else None,
            "author": (
                {"name": str(author.get("name"))[:256], "icon": _discord_img(author.get("proxy_icon_url") or author.get("icon_url")), "url": _http_url(author.get("url"))}
                if author.get("name")
                else None
            ),
            "title": _clean_text(str(e.get("title") or ""), gid)[:256],
            "url": _http_url(e.get("url")),
            "description": _clean_text(str(e.get("description") or ""), gid)[:4096],
            "fields": [
                {"name": _clean_text(str(f.get("name") or ""), gid)[:256], "value": _clean_text(str(f.get("value") or ""), gid)[:1024], "inline": bool(f.get("inline"))}
                for f in (e.get("fields") or [])[:25]
                if isinstance(f, dict)
            ],
            "image": await _embed_image(e.get("image"), owner, "imagem"),
            "thumbnail": await _embed_image(e.get("thumbnail"), owner, "miniatura"),
            "footer": (
                {"text": _clean_text(str(footer.get("text")), gid)[:2048], "icon": _discord_img(footer.get("proxy_icon_url") or footer.get("icon_url"))}
                if footer.get("text")
                else None
            ),
            "provider": str(provider.get("name") or "")[:256],
        }
        # cartão vazio (ex.: um link sem prévia): não mostra nada
        if any(card[k] for k in ("author", "title", "description", "fields", "image", "thumbnail", "footer")):
            out.append(card)
    return out


async def _download(url: str, name: str, owner_id: int | None, extra_hosts: frozenset[str] = frozenset()) -> dict | None:
    host = urlparse(url).hostname or ""
    if owner_id is None or urlparse(url).scheme not in ("https", "http") or (host not in CDN_HOSTS and host not in extra_hosts):
        return None
    try:
        with tempfile.TemporaryFile() as spool:
            async with httpx.AsyncClient(timeout=30, follow_redirects=False) as c:
                async with c.stream("GET", url, headers={"Accept-Encoding": "identity"}) as r:
                    if r.status_code != 200 or r.headers.get("content-encoding", "identity") != "identity":
                        return None
                    size = 0
                    async for chunk in r.aiter_raw(chunk_size=64 * 1024):
                        size += len(chunk)
                        if size > MAX_FILE:
                            return None
                        spool.write(chunk)
            spool.seek(0)
            return await save_upload(UploadFile(file=spool, filename=name[:120] or "arquivo"), "attachment", owner_id)
    except HTTPException:
        return None  # cota cheia ou arquivo recusado
    except Exception:
        log.warning("ponte: não baixei o anexo %s", name)
        return None


async def _to_app(link: dict, d: dict) -> None:
    from .messages import post_webhook_message

    author = d.get("author") or {}
    member = d.get("member") or {}
    content = _clean(d)
    attachments: list[dict] = []
    for a in (d.get("attachments") or [])[:MAX_FILES]:
        got = await _download(a.get("url") or "", a.get("filename") or "arquivo", link.get("created_by"))
        if got:
            got.pop("still", None)
            attachments.append(got)
        else:
            content += ("\n" if content else "") + f"[anexo: {a.get('filename') or 'arquivo'}]"
    for st in (d.get("sticker_items") or [])[:3]:
        ext = STICKER_EXT.get(int(st.get("format_type") or 0))
        got = None
        if ext and str(st.get("id") or "").isdigit() and len(attachments) < MAX_FILES:
            got = await _download(f"https://media.discordapp.net/stickers/{st['id']}.{ext}?size=320", f"{st.get('name') or 'figurinha'}.{ext}", link.get("created_by"))
        if got:
            got.pop("still", None)
            attachments.append(got)
        else:
            content += ("\n" if content else "") + f"[figurinha: {st.get('name') or ''}]"
    embeds = await _embeds(d, link.get("created_by"))
    content = content[:4000]
    if not content and not attachments and not embeds:
        return
    await post_webhook_message(
        link["channel_id"], link["channel_id"], _display(author, member), content,
        avatar=_avatar(author, member, str(d.get("guild_id"))), ext=str(author.get("id") or ""), attachments=attachments, embeds=embeds,
    )


# ------------------------------------------------------------------ aqui → Discord


def on_app_message(channel_id: int, msg: dict) -> None:
    """Chamado quando alguém manda mensagem aqui: se o canal tem ponte, manda para o Discord."""
    link = ponte.by_channel.get(channel_id)
    if link and TOKEN:
        ponte.submit(_to_discord, link, msg)


def _safe_name(name: str) -> str:
    # o Discord não aceita "discord" nem "clyde" no nome de webhook
    name = re.sub(r"(?i)discord", "Disc0rd", name or "")
    name = re.sub(r"(?i)clyde", "Clyd3", name).strip()
    return (name or "Alguém")[:80]


async def _to_discord(link: dict, msg: dict) -> None:
    lock = ponte.locks.setdefault(link["channel_id"], asyncio.Lock())
    async with lock:  # uma de cada vez, para chegar na ordem
        if ponte.by_channel.get(link["channel_id"]) is link:
            await _send_to_discord(link, msg)


async def _send_to_discord(link: dict, msg: dict) -> None:
    from .messages import post_webhook_message

    author = msg.get("author") or {}
    content = msg.get("content") or ""
    files: list[tuple[str, bytes, str]] = []
    ids = [int(a["id"]) for a in msg.get("attachments") or [] if a.get("id")]
    by_id = {}
    if ids:
        for r in await pool().fetch("SELECT id, name, mime, size, path FROM files WHERE id = ANY($1::bigint[])", ids):
            by_id[r["id"]] = r
    for a in msg.get("attachments") or []:
        if a.get("gif") or not a.get("id"):
            if a.get("url"):
                content += ("\n" if content else "") + a["url"]
            continue
        r = by_id.get(int(a["id"]))
        if not r or r["size"] > MAX_FILE or len(files) >= MAX_FILES:
            content += ("\n" if content else "") + f"(anexo grande demais para o Discord: {a.get('name') or 'arquivo'})"
            continue
        try:
            with (settings.upload_dir / r["path"]).open("rb") as source:
                data = source.read(MAX_FILE + 1)
            if len(data) <= MAX_FILE:
                files.append((r["name"] or "arquivo", data, r["mime"]))
        except OSError:
            continue
    content = content[:2000]
    if not content and not files:
        return
    av = author.get("avatar") or {}
    avatar = av.get("still") or av.get("url") or ""
    payload: dict[str, Any] = {"content": content, "username": _safe_name(author.get("display_name") or ""), "allowed_mentions": {"parse": []}}
    if avatar.startswith("https://"):
        payload["avatar_url"] = avatar
    path = f"/webhooks/{link['webhook_id']}/{link['webhook_token']}"
    if files:
        up = {f"files[{i}]": (n, data, mime) for i, (n, data, mime) in enumerate(files)}
        r = await _rest("POST", path, bot=False, data={"payload_json": json.dumps(payload)}, files=up)
    else:
        r = await _rest("POST", path, bot=False, json=payload)
    if r.status_code in (401, 404):  # apagaram o webhook lá: desliga a ponte e avisa
        await _unlink(link["channel_id"], delete_hook=False)
        await post_webhook_message(
            link["channel_id"], link["channel_id"], "Ponte do Discord",
            "A ponte com o Discord caiu (o webhook foi apagado lá). Um admin pode ligar de novo nas configurações do canal.",
        )
    elif r.status_code >= 300:
        log.warning("ponte: Discord respondeu %s ao webhook", r.status_code)


async def _unlink(channel_id: int, *, delete_hook: bool = True) -> dict | None:
    link = ponte.drop(channel_id)
    await pool().execute("DELETE FROM discord_links WHERE channel_id = $1", channel_id)
    if link and delete_hook:
        try:
            await _rest("DELETE", f"/webhooks/{link['webhook_id']}/{link['webhook_token']}", bot=False)
        except Exception:
            pass
    return link


async def _vunlink(channel_id: int) -> dict | None:
    link = ponte.vdrop(channel_id)
    await pool().execute("DELETE FROM discord_voice_links WHERE channel_id = $1", channel_id)
    if link:
        await hub.to_channel(channel_id, "discord_voice", {"channel_id": sid(channel_id), "members": []})
    return link


def discord_voice_snapshot(channel_ids: Any) -> dict[str, list[dict]]:
    """Quem está nas calls do Discord ligadas, para os canais de voz que a pessoa vê."""
    out: dict[str, list[dict]] = {}
    for cid in channel_ids:
        link = ponte.vby_channel.get(int(cid))
        if link:
            out[sid(link["channel_id"])] = ponte.in_call(link)
    return out


# ------------------------------------------------------------------ telas de configuração


def _status() -> dict:
    return {"configured": bool(TOKEN), "status": ponte.status, "error": ponte.erro, "bot_name": ponte.bot_name, "invite_url": ponte.invite_url()}


async def _bridge_admin(channel_id: int, user_id: int) -> dict:
    ch = await pool().fetchrow("SELECT id, server_id, type, name FROM channels WHERE id = $1", channel_id)
    if not ch or ch["server_id"] is None or ch["type"] not in ("text", "voice"):
        raise err(404, "Canal não encontrado.")
    await require_admin(ch["server_id"], user_id)
    return dict(ch)


def _link_out(link: dict | None) -> dict | None:
    if not link:
        return None
    created = link["created_at"]
    return {
        "discord_channel": link["discord_name"], "discord_server": link["guild_name"],
        "created_at": created.isoformat() if hasattr(created, "isoformat") else str(created),
    }


@router.get("/channels/{channel_id}/discord")
async def get_bridge(channel_id: str, me: Auth = CurrentUser) -> dict:
    cid = parse_id(channel_id)
    ch = await _bridge_admin(cid, me.id)
    if ch["type"] == "voice":
        link = ponte.vby_channel.get(cid)
        return {**_status(), "link": _link_out(link), "in_call": ponte.in_call(link) if link else []}
    return {**_status(), "link": _link_out(ponte.by_channel.get(cid))}


@router.post("/channels/{channel_id}/discord/code")
async def bridge_code(channel_id: str, me: Auth = CurrentUser) -> dict:
    cid = parse_id(channel_id)
    ch = await _bridge_admin(cid, me.id)
    if not TOKEN:
        raise err(400, "A ponte com o Discord ainda não foi configurada no servidor (falta o DISCORD_BOT_TOKEN).")
    now = time.time()
    for k, v in list(ponte.codes.items()):
        if v[2] < now or v[0] == cid:
            ponte.codes.pop(k, None)
    alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    a = "".join(secrets.choice(alphabet) for _ in range(4))
    b = "".join(secrets.choice(alphabet) for _ in range(4))
    ponte.codes[a + b] = (cid, me.id, now + CODE_TTL, ch["type"])
    return {"code": f"{a}-{b}", "command": f"!ponte {a}-{b}", "expires_in": CODE_TTL, **_status()}


@router.delete("/channels/{channel_id}/discord")
async def delete_bridge(channel_id: str, me: Auth = CurrentUser) -> dict:
    from .messages import post_webhook_message

    cid = parse_id(channel_id)
    ch = await _bridge_admin(cid, me.id)
    if ch["type"] == "voice":
        await _vunlink(cid)
        return {"ok": True, "id": sid(cid)}
    link = await _unlink(cid)
    if link:
        await post_webhook_message(cid, cid, "Ponte do Discord", "A ponte com o Discord foi desligada.")
    return {"ok": True, "id": sid(cid)}


# ------------------------------------------------------------------ serviço ponte-voz (Node, na mesma máquina)


@router.get("/internal/discord-voice")
async def voice_bridge_state(request: Request, x_bridge_secret: str = Header(default="")) -> dict:
    """O que o ponte-voz precisa: as calls ligadas e se tem gente dos dois lados (aí ele entra)."""
    host = request.client.host if request.client else ""
    if not VOICE_SECRET or not secrets.compare_digest(x_bridge_secret, VOICE_SECRET) or host not in ("127.0.0.1", "::1"):
        raise err(404, "Não encontrado.")
    out = []
    for link in list(ponte.vby_channel.values()):
        here = [uid for uid, st in hub.voice.get(link["channel_id"], {}).items() if not st.get("sdeaf")]
        there = ponte.in_call(link)
        out.append({
            "channel_id": sid(link["channel_id"]),
            "room": f"cdg-{link['channel_id']}",
            "guild_id": link["discord_guild_id"],
            "discord_channel_id": link["discord_channel_id"],
            "app_people": len(here),
            "discord_people": len(there),
            "active": bool(here and there),
        })
    return {"bot_ready": ponte.status == "ligado", "links": out}
