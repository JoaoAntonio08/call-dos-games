"""Minigames na call: Impostor, Forca, Quina (palavra de 5 letras sem fim), Adivinhe a música e Onde foi isso?

Quem manda no jogo é o servidor. A palavra secreta, quem é o impostor, a resposta da música e o lugar
da foto ficam aqui; cada pessoa recebe só a visão dela (hub.send para um usuário por vez). Só quem está
na call joga, e cada ação passa por um freio por pessoa.

Também fica aqui o "clipe de risada": o app de cada um detecta a própria risada (no PC, sem mandar áudio
para lugar nenhum) e só avisa "ri". Quando duas pessoas diferentes riem juntas, o servidor escolhe UM app
para salvar o clipe, para não sair um clipe por pessoa.
"""

from __future__ import annotations

import asyncio
import difflib
import html
import logging
import math
import os
import random
import re
import secrets
import time
from typing import Any

import httpx
from fastapi import APIRouter, Response
from pydantic import BaseModel, Field

from . import palavras
from .core import Auth, CurrentUser, err, parse_id, pool, sid
from .perms import member as perms_member
from .realtime import hub

log = logging.getLogger("minigames")
router = APIRouter()

KINDS = ("impostor", "forca", "quina", "musica", "mundo")
games: dict[int, "Game"] = {}
_last_act: dict[int, float] = {}
COMMONS = os.environ.get("COMMONS_BASE", "https://commons.wikimedia.org").rstrip("/")
# o Commons entrega as miniaturas por thumb.wikimedia.org (antes, upload.wikimedia.org)
UPLOADS = ("https://upload.wikimedia.org/", "https://thumb.wikimedia.org/")
USER_AGENT = "CallDosGames/2.5 (jogo entre amigos)"
PHOTO_MAX = 4 * 1024 * 1024
# memória: cada partida de fotos guarda até 10 fotos de 4 MB; e no máximo 2 preparações ao mesmo tempo
MAX_PHOTO_GAMES = 4
PREP_SLOTS = asyncio.Semaphore(2)
# criar partida é uma coisa de cada vez: o limite de partidas com fotos e a troca de jogo não correm em paralelo
START_LOCK = asyncio.Lock()


def norm(s: str) -> str:
    """Para comparar chutes: sem acento, minúsculo, só letras/números e um espaço entre palavras."""
    return " ".join(re.sub(r"[^a-z0-9]+", " ", palavras.plain(s or "")).split())


def in_call(uid: int, cid: int) -> bool:
    return hub.user_voice.get(uid) == cid


def call_members(cid: int) -> list[int]:
    return list(hub.voice.get(cid, {}).keys())


def throttle(uid: int, gap: float) -> bool:
    """True se a pessoa está mandando rápido demais."""
    now = time.monotonic()
    if now - _last_act.get(uid, 0) < gap:
        return True
    _last_act[uid] = now
    return False


async def server_of(cid: int) -> int | None:
    return await pool().fetchval("SELECT server_id FROM channels WHERE id = $1", cid)


async def channel_open(cid: int) -> bool:
    """Call sem cargo na visão (aberta a todo o servidor). Usa o mesmo cache da retrospectiva, que é
    esquecido na hora em que alguém muda a permissão do canal."""
    from . import conquistas  # noqa: PLC0415

    return await conquistas._public_server_of(cid) is not None


async def can_moderate(cid: int, uid: int) -> bool:
    server_id = await server_of(cid)
    if not server_id:
        return False
    who = await perms_member(server_id, uid)
    return bool(who and who.can("moderar_voz"))


async def _reward(kind: str, server_id: int | None, uid: int, n: int = 1) -> None:
    """Contadores das conquistas secretas e vitórias do mês (não deixa o jogo cair se o banco falhar)."""
    try:
        from . import conquistas  # noqa: PLC0415

        if kind == "win":
            await conquistas.won_game(server_id, uid)
        else:
            await conquistas.bump(uid, kind, n)
    except Exception as e:  # noqa: BLE001
        log.warning("minigames: não deu para contar %s (%s)", kind, type(e).__name__)


# ------------------------------------------------------------------ base
class Game:
    kind = ""
    min_players = 1

    def __init__(self, cid: int, host: int, players: list[int], server_id: int | None) -> None:
        self.cid = cid
        self.host = host
        self.server_id = server_id
        self.players: list[int] = list(players)
        self.score: dict[int, int] = {p: 0 for p in players}
        self.phase = "play"
        self.stage = 0  # muda a cada fase/rodada: o cronômetro velho não mexe na fase nova
        self.ends_at: int | None = None
        self.timer: asyncio.Task | None = None
        self.notice = ""
        # uma coisa de cada vez por partida: jogada e cronômetro não mexem no estado ao mesmo tempo
        self.lock = asyncio.Lock()
        self.prep: asyncio.Task | None = None
        self.rewarded: set[tuple[str, int, int]] = set()
        # call com cargo na visão: vitória não entra na retrospectiva do servidor
        self.public = True

    def join(self, uid: int) -> None:
        if uid not in self.players:
            self.players.append(uid)
            self.score.setdefault(uid, 0)

    def schedule(self, seconds: float, fn) -> None:
        self.cancel_timer()
        self.stage += 1
        stage = self.stage
        self.ends_at = int((time.time() + seconds) * 1000)

        async def run() -> None:
            await asyncio.sleep(seconds)
            async with self.lock:
                if games.get(self.cid) is not self or self.stage != stage:
                    return
                try:
                    await fn()
                    await push(self)
                except Exception as e:  # noqa: BLE001
                    log.warning("minigames: cronômetro falhou (%s)", type(e).__name__)

        self.timer = asyncio.create_task(run())

    def cancel_timer(self) -> None:
        if self.timer and not self.timer.done() and self.timer is not asyncio.current_task():
            self.timer.cancel()
        self.timer = None
        self.ends_at = None

    def retire(self) -> None:
        """A partida saiu de cena: para cronômetro e preparação e solta as fotos da memória."""
        self.cancel_timer()
        if self.prep and not self.prep.done() and self.prep is not asyncio.current_task():
            self.prep.cancel()
        self.prep = None
        if hasattr(self, "images"):
            self.images = []

    async def give(self, kind: str, uid: int) -> None:
        """Recompensa uma vez só por pessoa em cada fase, mesmo se o fim da rodada rodar de novo."""
        key = (kind, uid, self.stage)
        if key in self.rewarded:
            return
        self.rewarded.add(key)
        # a call pode ter virado privada no meio do jogo: confere de novo antes de contar para o servidor
        if self.public:
            try:
                self.public = await channel_open(self.cid)
            except Exception:  # noqa: BLE001
                self.public = False
        await _reward(kind, self.server_id if self.public else None, uid)

    def view(self, uid: int) -> dict[str, Any]:
        return {}

    async def act(self, uid: int, body: "ActIn") -> dict[str, Any] | None:
        return None


def view_for(g: Game, uid: int) -> dict[str, Any]:
    return {
        "kind": g.kind,
        "host_id": sid(g.host),
        "players": [sid(p) for p in g.players],
        "score": {sid(p): n for p, n in g.score.items()},
        "phase": g.phase,
        "ends_at": g.ends_at,
        "notice": g.notice,
        **g.view(uid),
    }


async def push(g: Game) -> None:
    for uid in set(call_members(g.cid)) | set(g.players):
        await hub.send([uid], "minigame", {"channel_id": sid(g.cid), "game": view_for(g, uid)})


async def finish(cid: int) -> None:
    g = games.pop(cid, None)
    if g:
        g.retire()
        for uid in set(call_members(cid)) | set(g.players):
            await hub.send([uid], "minigame", {"channel_id": sid(cid), "game": None})


# ------------------------------------------------------------------ Impostor
class Impostor(Game):
    kind = "impostor"
    min_players = 3

    def setup(self, opts: dict[str, Any]) -> None:
        theme = str(opts.get("theme") or "aleatorio")
        if theme != "aleatorio" and theme not in palavras.TEMAS:
            raise err(400, "Tema desconhecido.")
        self.theme_choice = theme
        self.mode = "palavra_diferente" if opts.get("mode") == "palavra_diferente" else "sem_palavra"
        self.new_round()

    def new_round(self) -> None:
        self.cancel_timer()
        self.theme = random.choice(list(palavras.TEMAS)) if self.theme_choice == "aleatorio" else self.theme_choice
        self.word, self.alt = random.sample(palavras.TEMAS[self.theme]["palavras"], 2)
        n = 2 if len(self.players) >= 7 else 1
        self.impostors = set(random.sample(self.players, n))
        self.alive = list(self.players)
        self.order = random.sample(self.alive, len(self.alive))
        self.votes: dict[int, int | None] = {}
        self.phase = "talk"
        self.result: dict[str, Any] | None = None
        self.guesser: int | None = None
        self.winner = ""
        self.stage += 1

    def view(self, uid: int) -> dict[str, Any]:
        v: dict[str, Any] = {
            "theme": palavras.TEMAS[self.theme]["nome"],
            "theme_id": self.theme_choice,
            "mode": self.mode,
            "alive": [sid(p) for p in self.alive],
            "order": [sid(p) for p in self.order if p in self.alive],
            "voted": [sid(p) for p in self.votes],
            "impostor_count": len(self.impostors),
            "result": self.result,
        }
        if uid in self.players and self.phase != "end":
            if self.mode == "sem_palavra":
                v["card"] = {"impostor": True} if uid in self.impostors else {"word": self.word}
            else:
                # no modo "palavra diferente" o impostor nem sabe que é: recebe uma parecida
                v["card"] = {"word": self.alt if uid in self.impostors else self.word}
        if self.phase == "guess":
            v["guesser"] = sid(self.guesser)
        if self.phase == "end":
            v["word"] = self.word
            v["alt"] = self.alt if self.mode == "palavra_diferente" else None
            v["impostors"] = [sid(p) for p in self.impostors]
            v["winner"] = self.winner
        return v

    def _voters(self) -> list[int]:
        return [p for p in self.alive if in_call(p, self.cid)]

    async def act(self, uid: int, body: "ActIn") -> dict[str, Any] | None:
        a = body.action
        if a == "nova":
            if uid != self.host and not await can_moderate(self.cid, uid):
                raise err(403, "Só quem começou o jogo puxa a próxima rodada.")
            self.players = [p for p in call_members(self.cid)]
            if len(self.players) < self.min_players:
                raise err(400, "Precisa de pelo menos 3 pessoas na call.")
            for p in self.players:
                self.score.setdefault(p, 0)
            self.new_round()
            return None
        if a == "chute" and self.phase == "guess" and uid == self.guesser:
            got = norm(body.text or "") == norm(self.word)
            await self.end("impostor" if got else "turma", f"O impostor chutou “{(body.text or '')[:40]}”: {'acertou!' if got else 'errou.'}")
            return None
        if uid not in self.alive:
            raise err(403, "Você está assistindo esta rodada.")
        if a == "votacao" and self.phase == "talk":
            self.phase = "vote"
            self.votes = {}
            self.schedule(90, self.resolve)
            return None
        if a == "voto" and self.phase == "vote":
            target = None if body.target in (None, "", "pular") else parse_id(body.target)
            if target is not None and (target not in self.alive or target == uid):
                raise err(400, "Voto inválido.")
            self.votes[uid] = target
            if all(p in self.votes for p in self._voters()):
                await self.resolve()
            return None
        raise err(400, "Não dá para fazer isso agora.")

    async def resolve(self) -> None:
        self.cancel_timer()
        tally: dict[int, int] = {}
        skips = 0
        for t in self.votes.values():
            if t is None:
                skips += 1
            else:
                tally[t] = tally.get(t, 0) + 1
        top = max(tally.values(), default=0)
        leaders = [p for p, n in tally.items() if n == top]
        out = leaders[0] if top and len(leaders) == 1 and top > skips else None
        votes = {sid(p): n for p, n in tally.items()}
        if out is None:
            self.result = {"text": "Empate ou pulo: ninguém saiu. Conversem mais um pouco.", "out": None, "votes": votes}
            self.phase = "talk"
            self.stage += 1
            return
        was = out in self.impostors
        self.alive.remove(out)
        self.result = {"out": sid(out), "was_impostor": was, "votes": votes}
        if was:
            left = [p for p in self.alive if p in self.impostors]
            if left:
                self.result["text"] = "Era um impostor! Mas ainda tem outro por aí."
            elif self.mode == "sem_palavra":
                # pego: ainda pode roubar a vitória acertando a palavra
                self.guesser = out
                self.phase = "guess"
                self.result["text"] = "Pegaram o impostor! Ele tem 30 s para chutar a palavra e roubar a vitória."
                self.schedule(30, lambda: self.end("turma", "O impostor não chutou a tempo."))
                return
            else:
                await self.end("turma", "Pegaram o impostor!")
                return
        else:
            innocents = [p for p in self.alive if p not in self.impostors]
            imps = [p for p in self.alive if p in self.impostors]
            if len(imps) >= len(innocents):
                await self.end("impostor", "Saiu um inocente e os impostores empataram com a turma.")
                return
            self.result["text"] = "Era inocente! O impostor continua entre vocês."
        self.phase = "talk"
        self.votes = {}
        self.stage += 1

    async def end(self, winner: str, text: str) -> None:
        self.cancel_timer()
        self.phase = "end"
        self.winner = winner
        self.result = {**(self.result or {}), "text": text}
        champs = list(self.impostors) if winner == "impostor" else [p for p in self.players if p not in self.impostors]
        for p in champs:
            self.score[p] = self.score.get(p, 0) + (2 if winner == "impostor" else 1)
            await self.give("win", p)
            if winner == "impostor":
                await self.give("impostor", p)


# ------------------------------------------------------------------ Forca
class Forca(Game):
    kind = "forca"

    def setup(self, opts: dict[str, Any]) -> None:
        theme = str(opts.get("theme") or "aleatorio")
        if theme != "aleatorio" and theme not in palavras.TEMAS:
            raise err(400, "Tema desconhecido.")
        self.theme_choice = theme
        self.new_word()

    def new_word(self) -> None:
        self.cancel_timer()
        self.theme = random.choice(list(palavras.TEMAS)) if self.theme_choice == "aleatorio" else self.theme_choice
        self.secret = random.choice(palavras.TEMAS[self.theme]["palavras"])
        self.letters = {c for c in norm(self.secret) if c.isalpha()}
        self.hits: set[str] = set()
        self.misses: list[str] = []
        self.lives = 6
        self.solved = False
        self.phase = "play"
        self.stage += 1

    def mask(self) -> str:
        return "".join(ch if not palavras.plain(ch).isalpha() or palavras.plain(ch) in self.hits else "_" for ch in self.secret)

    def view(self, uid: int) -> dict[str, Any]:
        return {
            "theme": palavras.TEMAS[self.theme]["nome"],
            "theme_id": self.theme_choice,
            "mask": self.secret if self.phase == "end" else self.mask(),
            "hits": sorted(self.hits),
            "misses": self.misses,
            "lives": self.lives,
            "solved": self.solved,
        }

    async def act(self, uid: int, body: "ActIn") -> dict[str, Any] | None:
        a = body.action
        if a == "nova":
            if self.phase != "end" and uid != self.host and not await can_moderate(self.cid, uid):
                raise err(403, "Terminem esta palavra antes.")
            self.new_word()
            return None
        if self.phase != "play":
            raise err(400, "Esta palavra já acabou.")
        if throttle(uid, 0.6):
            raise err(429, "Calma, uma letra de cada vez.")
        self.join(uid)
        if a == "letra":
            letter = norm(body.text or "")
            if len(letter) != 1 or not letter.isalpha():
                raise err(400, "Mande uma letra só.")
            if letter in self.hits or letter in self.misses:
                return {"repeat": True}
            if letter in self.letters:
                self.hits.add(letter)
                self.score[uid] += sum(1 for c in norm(self.secret) if c == letter)
                if self.letters <= self.hits:
                    await self.win(uid, 3)
            else:
                self.misses.append(letter)
                self.lives -= 1
                if self.lives <= 0:
                    self.lose()
            return None
        if a == "palavra":
            if norm(body.text or "").replace(" ", "") == norm(self.secret).replace(" ", ""):
                await self.win(uid, 3 + len(self.letters - self.hits))
                self.hits = set(self.letters)
            else:
                self.lives -= 2
                self.notice = "Chute errado custa 2 vidas."
                if self.lives <= 0:
                    self.lose()
            return None
        raise err(400, "Ação desconhecida.")

    async def win(self, uid: int, points: int) -> None:
        self.score[uid] += points
        self.solved = True
        self.phase = "end"
        await self.give("win", uid)

    def lose(self) -> None:
        self.lives = 0
        self.phase = "end"


# ------------------------------------------------------------------ Quina
def marks(guess: str, secret: str) -> list[int]:
    """2 = letra no lugar certo, 1 = existe em outro lugar, 0 = não tem (letras repetidas contam certo)."""
    out = [0] * 5
    left: dict[str, int] = {}
    for i, (g, s) in enumerate(zip(guess, secret)):
        if g == s:
            out[i] = 2
        else:
            left[s] = left.get(s, 0) + 1
    for i, g in enumerate(guess):
        if out[i] == 0 and left.get(g, 0) > 0:
            out[i] = 1
            left[g] -= 1
    return out


class Quina(Game):
    kind = "quina"
    TRIES = 6

    def setup(self, opts: dict[str, Any]) -> None:
        self.streak = 0
        self.best = 0
        self.new_word()

    async def next_word(self) -> None:
        self.new_word()

    def new_word(self) -> None:
        self.cancel_timer()
        self.secret = random.choice(palavras.QUINA)
        self.rows: list[dict[str, Any]] = []
        self.solved = False
        self.phase = "play"
        self.stage += 1

    def view(self, uid: int) -> dict[str, Any]:
        return {
            "rows": self.rows,
            "tries": self.TRIES,
            "streak": self.streak,
            "best": self.best,
            "solved": self.solved,
            "word": self.secret if self.phase == "end" else None,
        }

    async def act(self, uid: int, body: "ActIn") -> dict[str, Any] | None:
        if body.action == "pular":
            if uid != self.host and not await can_moderate(self.cid, uid):
                raise err(403, "Só quem começou pode pular a palavra.")
            self.streak = 0
            self.phase = "end"
            self.schedule(3, self.next_word)
            return None
        if body.action != "chute":
            raise err(400, "Ação desconhecida.")
        if self.phase != "play":
            raise err(400, "Espere a próxima palavra.")
        if throttle(uid, 1.0):
            raise err(429, "Calma, um chute por vez.")
        word = norm(body.text or "").replace(" ", "")
        if len(word) != 5 or not word.isalpha():
            raise err(400, "A palavra tem 5 letras.")
        if any(r["word"] == word for r in self.rows):
            raise err(400, "Essa já foi.")
        self.join(uid)
        m = marks(word, self.secret)
        self.rows.append({"by": sid(uid), "word": word, "marks": m})
        if all(x == 2 for x in m):
            self.solved = True
            self.score[uid] += max(1, self.TRIES + 1 - len(self.rows))
            self.streak += 1
            self.best = max(self.best, self.streak)
            self.phase = "end"
            await self.give("win", uid)
            self.schedule(5, self.next_word)
        elif len(self.rows) >= self.TRIES:
            self.streak = 0
            self.phase = "end"
            self.schedule(6, self.next_word)
        return None


# ------------------------------------------------------------------ Adivinhe a música
STYLES = {
    "historico": "",
    "sucessos": "sucessos músicas brasileiras",
    "anime": "anime opening",
    "games": "video game soundtrack",
    "rock": "rock clássico",
    "funk": "funk brasileiro",
    "sertanejo": "sertanejo sucessos",
}
_JUNK = re.compile(
    r"\((?:[^)]*)\)|\[(?:[^\]]*)\]|\b(?:official|oficial|music|video|clipe|lyrics?|letra|audio|ao vivo|live|hd|4k|remaster(?:ed)?|visualizer)\b",
    re.I,
)


def song_keys(title: str, author: str) -> set[str]:
    """As respostas que valem: o nome da música (e o título inteiro limpo); o artista sozinho não vale."""
    t = re.split(r"\b(?:feat|ft)\.?\s", _JUNK.sub(" ", html.unescape(title or "")), flags=re.I)[0]
    parts = [p for p in re.split(r"\s+[-–—|:]\s+|\s+[-–—]\s*|\s*[\"“”]\s*", t) if norm(p)]
    artist = norm(re.sub(r"\s*-\s*topic$", "", author or "", flags=re.I))
    keys = {norm(p) for p in parts if norm(p) != artist and len(norm(p)) >= 2}
    whole = norm(t)
    if whole and whole != artist:
        keys.add(whole)
    return keys


def song_matches(guess: str, keys: set[str]) -> bool:
    g = norm(guess)
    if len(g) < 2:
        return False
    for k in keys:
        if g == k:
            return True
        if len(g) >= 4 and g in k and len(g) >= 0.6 * len(k):
            return True
        if difflib.SequenceMatcher(None, g, k).ratio() >= 0.8:
            return True
    return False


class Musica(Game):
    kind = "musica"
    ROUND = 30

    def setup(self, opts: dict[str, Any]) -> None:
        self.rounds = max(3, min(15, int(opts.get("rounds") or 8)))
        self.style = str(opts.get("style") or "historico")
        if self.style not in STYLES:
            raise err(400, "Estilo desconhecido.")
        self.songs: list[tuple[str, str, str]] = []
        self.round = 0
        self.cur: tuple[str, str, str] | None = None
        self.got: list[int] = []
        self.start = 0

    async def prepare(self) -> None:
        pool_: dict[str, tuple[str, str, str]] = {}
        if self.style == "historico" and self.server_id:
            rows = await pool().fetch(
                """SELECT DISTINCT ON (m.video_id) m.video_id, m.title, m.author FROM music_log m
                   JOIN channels c ON c.id = m.channel_id
                   WHERE m.server_id = $1 AND m.played_at > now() - interval '365 days' AND m.title <> ''
                     AND (m.channel_id = $2 OR cardinality(c.view_roles) = 0)
                   ORDER BY m.video_id, m.played_at DESC LIMIT 400""",
                self.server_id,
                self.cid,
            )
            pool_ = {r["video_id"]: (r["video_id"], r["title"], r["author"]) for r in rows}
        query = STYLES[self.style] or STYLES["sucessos"]
        if len(pool_) < self.rounds:
            from .core import settings  # noqa: PLC0415
            from .routes import radio  # noqa: PLC0415

            if settings.youtube_key:
                for v in await radio._search(query, n=40):
                    pool_.setdefault(v[0], v)
        songs = [s for s in pool_.values() if song_keys(s[1], s[2])]
        if len(songs) < 4:
            raise err(400, "Precisa de pelo menos 4 músicas: toquem umas na call antes (ou escolham um estilo).")
        random.shuffle(songs)
        self.songs = songs[: self.rounds]
        self.rounds = len(self.songs)

    async def next_round(self) -> None:
        self.cancel_timer()
        if self.round >= self.rounds:
            self.phase = "end"
            await self.award_end()
            return
        self.cur = self.songs[self.round]
        self.round += 1
        self.got = []
        self.start = random.randint(25, 70)
        self.phase = "play"
        self.schedule(self.ROUND, self.reveal)

    async def reveal(self) -> None:
        self.phase = "reveal"
        self.schedule(7, self.next_round)

    async def award_end(self) -> None:
        if self.score:
            top = max(self.score.values())
            if top > 0:
                for p, n in self.score.items():
                    if n == top:
                        await self.give("win", p)

    def view(self, uid: int) -> dict[str, Any]:
        v: dict[str, Any] = {"round": self.round, "rounds": self.rounds, "got": [sid(p) for p in self.got], "style": self.style}
        if self.cur and self.phase == "play":
            # o app precisa do vídeo para tocar o trecho; o título só aparece no fim da rodada
            v["video_id"] = self.cur[0]
            v["start"] = self.start
            v["you_got"] = uid in self.got
        if self.cur and self.phase in ("reveal", "end"):
            v["answer"] = {"title": self.cur[1], "author": self.cur[2], "video_id": self.cur[0]}
        return v

    async def act(self, uid: int, body: "ActIn") -> dict[str, Any] | None:
        if body.action == "pular" and self.phase == "play":
            if uid != self.host and not await can_moderate(self.cid, uid):
                raise err(403, "Só quem começou pode pular.")
            await self.reveal()
            return None
        if body.action != "chute" or self.phase != "play" or not self.cur:
            raise err(400, "Espere a próxima música.")
        if throttle(uid, 0.8):
            raise err(429, "Calma, um chute por vez.")
        self.join(uid)
        if uid in self.got:
            return {"ok": True}
        if not song_matches(body.text or "", song_keys(self.cur[1], self.cur[2])):
            return {"ok": False}
        points = (3, 2)[len(self.got)] if len(self.got) < 2 else 1
        self.got.append(uid)
        self.score[uid] += points
        await self.give("ouvido", uid)
        if all(p in self.got for p in call_members(self.cid)):
            await self.reveal()
        return {"ok": True}


# ------------------------------------------------------------------ Onde foi isso?
# pontos de partida pelo mundo: a foto sai de perto de um deles (Wikimedia Commons, fotos livres)
SEEDS: list[tuple[float, float]] = [
    (-22.95, -43.21), (-23.55, -46.63), (-15.79, -47.88), (-12.97, -38.50), (-3.73, -38.52), (-8.05, -34.90),
    (-30.03, -51.23), (-25.43, -49.27), (-3.10, -60.02), (-1.45, -48.50), (-20.32, -40.34), (-27.59, -48.55),
    (-34.60, -58.38), (-33.45, -70.66), (-12.05, -77.04), (4.71, -74.07), (19.43, -99.13), (23.13, -82.38),
    (40.71, -74.01), (34.05, -118.24), (41.88, -87.63), (37.77, -122.42), (25.76, -80.19), (49.28, -123.12),
    (45.50, -73.57), (61.22, -149.90), (21.31, -157.86), (51.51, -0.13), (48.86, 2.35), (52.52, 13.40),
    (41.90, 12.50), (40.42, -3.70), (38.72, -9.14), (41.39, 2.17), (52.37, 4.90), (50.85, 4.35), (59.33, 18.07),
    (59.91, 10.75), (55.68, 12.57), (60.17, 24.94), (64.15, -21.94), (53.35, -6.26), (55.95, -3.19),
    (48.21, 16.37), (50.08, 14.44), (47.50, 19.04), (52.23, 21.01), (37.98, 23.73), (41.01, 28.98),
    (55.76, 37.62), (59.94, 30.31), (30.04, 31.24), (33.57, -7.59), (31.63, -8.01), (-33.92, 18.42),
    (-26.20, 28.05), (-1.29, 36.82), (6.52, 3.38), (14.69, -17.45), (9.03, 38.74), (-18.88, 47.51),
    (25.20, 55.27), (31.77, 35.21), (24.71, 46.68), (35.69, 51.39), (28.61, 77.21), (19.08, 72.88),
    (27.17, 78.04), (13.08, 80.27), (27.72, 85.32), (6.93, 79.85), (13.76, 100.50), (21.03, 105.85),
    (1.35, 103.82), (3.14, 101.69), (-6.21, 106.85), (-8.65, 115.22), (14.60, 120.98), (22.32, 114.17),
    (31.23, 121.47), (39.90, 116.40), (25.03, 121.57), (37.57, 126.98), (35.68, 139.69), (34.99, 135.76),
    (43.06, 141.35), (-33.87, 151.21), (-37.81, 144.96), (-31.95, 115.86), (-36.85, 174.76), (-45.03, 168.66),
    (-17.71, 178.07), (64.84, -147.72), (69.65, 18.96), (-54.80, -68.30), (-13.16, -72.55), (-16.50, -68.15),
    (-0.18, -78.47), (10.49, -66.88), (18.47, -69.90), (9.93, -84.08), (36.17, -115.14), (36.11, -112.11),
]
_SKIP = re.compile(r"\b(map|mapa|logo|flag|bandeira|diagram|coat of arms|bras[aã]o|chart|plan|plano|seal|selo|scan)\b", re.I)


def _year_of(meta: dict[str, Any]) -> int | None:
    for key in ("DateTimeOriginal", "DateTime"):
        raw = str((meta.get(key) or {}).get("value") or "")
        m = re.search(r"\b(18[5-9]\d|19\d\d|20\d\d)\b", re.sub(r"<[^>]+>", " ", raw))
        if m and int(m.group(1)) <= time.gmtime().tm_year:
            return int(m.group(1))
    return None


def _text(meta: dict[str, Any], key: str, limit: int = 120) -> str:
    raw = str((meta.get(key) or {}).get("value") or "")
    return " ".join(html.unescape(re.sub(r"<[^>]+>", " ", raw)).split())[:limit]


def pick_photo(data: dict[str, Any], want_year: bool, used: set[str]) -> dict[str, Any] | None:
    """Escolhe uma foto boa da resposta da API do Commons (com lugar, e com ano se o modo pedir)."""
    pages = list(((data or {}).get("query") or {}).get("pages", {}).values())
    random.shuffle(pages)
    for p in pages:
        title = str(p.get("title") or "")
        info = (p.get("imageinfo") or [{}])[0]
        coords = (p.get("coordinates") or [{}])[0]
        meta = info.get("extmetadata") or {}
        url = str(info.get("thumburl") or "").split("?", 1)[0]  # sem os utm_* que o Commons pendura
        if title in used or _SKIP.search(title) or info.get("mime") != "image/jpeg":
            continue
        if not url.startswith(UPLOADS) or int(info.get("width") or 0) < 900:
            continue
        if "lat" not in coords or "lon" not in coords:
            continue
        year = _year_of(meta)
        if want_year and year is None:
            continue
        return {
            "title": title,
            "url": url,
            "lat": float(coords["lat"]),
            "lon": float(coords["lon"]),
            "year": year,
            "artist": _text(meta, "Artist") or "autor desconhecido",
            "license": _text(meta, "LicenseShortName", 40),
            "page": str(info.get("descriptionurl") or ""),
        }
    return None


async def fetch_photo_bytes(c: httpx.AsyncClient, url: str) -> tuple[bytes, str] | None:
    if not url.startswith(UPLOADS):
        return None
    async with c.stream("GET", url) as r:
        if r.status_code != 200 or not str(r.headers.get("content-type", "")).startswith("image/jpeg"):
            return None
        buf = bytearray()
        async for chunk in r.aiter_bytes():
            buf += chunk
            if len(buf) > PHOTO_MAX:
                return None
    clean = strip_jpeg_meta(bytes(buf))
    return (clean, "image/jpeg") if clean else None


def strip_jpeg_meta(data: bytes) -> bytes | None:
    """Tira EXIF/XMP/comentários do JPEG (APP1..APP15 e COM): a foto do Commons costuma trazer
    GPS e data no EXIF, e daria para colar a resposta baixando a imagem. None = JPEG malformado."""
    if data[:2] != b"\xff\xd8":
        return None
    out = bytearray(b"\xff\xd8")
    i = 2
    while i + 4 <= len(data):
        if data[i] != 0xFF:
            return None
        marker = data[i + 1]
        if marker == 0xFF:  # preenchimento
            i += 1
            continue
        if marker == 0xDA:  # começo da imagem em si: dali para frente vai tudo
            out += data[i:]
            return bytes(out)
        size = int.from_bytes(data[i + 2 : i + 4], "big")
        if size < 2 or i + 2 + size > len(data):
            return None
        if not (0xE1 <= marker <= 0xEF or marker == 0xFE):
            out += data[i : i + 2 + size]
        i += 2 + size
    return None


def distance_km(a: tuple[float, float], b: tuple[float, float]) -> float:
    la1, lo1, la2, lo2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 6371 * 2 * math.asin(min(1.0, math.sqrt(h)))


def place_points(km: float) -> int:
    return round(5000 * math.exp(-km / 2000))


def year_points(diff: int) -> int:
    return round(5000 * math.exp(-abs(diff) / 8))


class Mundo(Game):
    kind = "mundo"

    def setup(self, opts: dict[str, Any]) -> None:
        self.rounds = max(3, min(10, int(opts.get("rounds") or 5)))
        self.with_year = opts.get("mode") == "quando"
        self.photos: list[dict[str, Any]] = []
        self.images: list[tuple[bytes, str]] = []
        self.token = secrets.token_urlsafe(9)
        self.round = 0
        self.guesses: dict[int, dict[str, Any]] = {}
        self.results: list[dict[str, Any]] = []
        self.phase = "loading"

    async def prepare(self) -> None:
        used: set[str] = set()
        async with httpx.AsyncClient(timeout=8, headers={"User-Agent": USER_AGENT}, follow_redirects=False) as c:
            for _ in range(self.rounds * 6):
                if len(self.photos) >= self.rounds:
                    break
                lat, lon = random.choice(SEEDS)
                try:
                    r = await c.get(
                        COMMONS + "/w/api.php",
                        params={
                            "action": "query", "format": "json", "generator": "geosearch",
                            "ggscoord": f"{lat}|{lon}", "ggsradius": "10000", "ggslimit": "40", "ggsnamespace": "6",
                            "prop": "imageinfo|coordinates", "iiprop": "url|extmetadata|mime|size", "iiurlwidth": "1280",
                        },
                    )
                    if r.status_code != 200:
                        continue
                    photo = pick_photo(r.json(), self.with_year, used)
                    if not photo:
                        continue
                    got = await fetch_photo_bytes(c, photo["url"])
                    if not got:
                        continue
                except (httpx.HTTPError, ValueError):
                    continue
                used.add(photo["title"])
                self.photos.append(photo)
                self.images.append(got)
        if len(self.photos) < 2:
            raise RuntimeError("sem fotos")
        self.rounds = len(self.photos)

    async def next_round(self) -> None:
        self.cancel_timer()
        if self.round >= self.rounds:
            self.phase = "end"
            if self.score:
                top = max(self.score.values())
                for p, n in self.score.items():
                    if n == top and top > 0:
                        await self.give("win", p)
            return
        self.round += 1
        self.guesses = {}
        self.phase = "play"
        self.schedule(100 if self.with_year else 75, self.reveal)

    async def reveal(self) -> None:
        photo = self.photos[self.round - 1]
        rows = []
        for uid, g in self.guesses.items():
            km = distance_km((g["lat"], g["lon"]), (photo["lat"], photo["lon"]))
            pts = place_points(km)
            ypts = year_points(g["year"] - photo["year"]) if self.with_year and photo["year"] and g.get("year") else 0
            self.score[uid] = self.score.get(uid, 0) + pts + ypts
            rows.append({"user_id": sid(uid), "lat": g["lat"], "lon": g["lon"], "year": g.get("year"), "km": round(km), "points": pts + ypts})
            if pts >= 4950:
                await self.give("globo", uid)
        self.results = sorted(rows, key=lambda r: -r["points"])
        self.phase = "reveal"
        self.schedule(14, self.next_round)

    def view(self, uid: int) -> dict[str, Any]:
        v: dict[str, Any] = {"round": self.round, "rounds": self.rounds, "with_year": self.with_year, "guessed": [sid(p) for p in self.guesses]}
        if self.round and self.phase in ("play", "reveal", "end"):
            v["image"] = f"/calls/{sid(self.cid)}/minigame/foto/{self.token}/{self.round}"
        if self.phase == "play" and uid in self.guesses:
            v["mine"] = self.guesses[uid]
        if self.phase in ("reveal", "end") and self.round:
            p = self.photos[self.round - 1]
            v["answer"] = {k: p[k] for k in ("lat", "lon", "year", "artist", "license", "page")}
            v["results"] = self.results
        return v

    async def act(self, uid: int, body: "ActIn") -> dict[str, Any] | None:
        if body.action == "proxima" and self.phase == "reveal":
            if uid != self.host and not await can_moderate(self.cid, uid):
                raise err(403, "Só quem começou pode avançar.")
            await self.next_round()
            return None
        if body.action != "chute" or self.phase != "play":
            raise err(400, "Espere a próxima foto.")
        if body.lat is None or body.lon is None or not (-90 <= body.lat <= 90) or not (-180 <= body.lon <= 180):
            raise err(400, "Marque um lugar no mapa.")
        year = None
        if self.with_year:
            if body.year is None or not (1850 <= body.year <= time.gmtime().tm_year):
                raise err(400, "Escolha o ano.")
            year = int(body.year)
        if throttle(uid, 0.5):
            raise err(429, "Calma.")
        self.join(uid)
        self.guesses[uid] = {"lat": round(float(body.lat), 4), "lon": round(float(body.lon), 4), "year": year}
        if all(p in self.guesses for p in call_members(self.cid)):
            await self.reveal()
        return None


CLASSES: dict[str, type[Game]] = {"impostor": Impostor, "forca": Forca, "quina": Quina, "musica": Musica, "mundo": Mundo}


# ------------------------------------------------------------------ rotas
class StartIn(BaseModel):
    kind: str = Field(max_length=20)
    theme: str | None = Field(default=None, max_length=30)
    mode: str | None = Field(default=None, max_length=30)
    style: str | None = Field(default=None, max_length=30)
    rounds: int | None = Field(default=None, ge=1, le=20)


class ActIn(BaseModel):
    action: str = Field(max_length=20)
    target: str | None = Field(default=None, max_length=30)
    text: str | None = Field(default=None, max_length=80)
    lat: float | None = None
    lon: float | None = None
    year: int | None = None


def _must_be_in_call(me: Auth, cid: int) -> None:
    if not in_call(me.id, cid):
        raise err(403, "Entre na call para jogar.")


@router.get("/calls/{channel_id}/minigame")
async def get_game(channel_id: str, me: Auth = CurrentUser) -> dict:
    cid = parse_id(channel_id)
    _must_be_in_call(me, cid)
    g = games.get(cid)
    return {"game": view_for(g, me.id) if g else None}


@router.post("/calls/{channel_id}/minigame")
async def start_game(channel_id: str, body: StartIn, me: Auth = CurrentUser) -> dict:
    cid = parse_id(channel_id)
    _must_be_in_call(me, cid)
    if body.kind not in CLASSES:
        raise err(400, "Jogo desconhecido.")
    async with START_LOCK:
        g = await _create_game(cid, body, me)
    if isinstance(g, (Musica, Mundo)):
        g.phase = "loading"
        await push(g)
        g.prep = asyncio.create_task(_prepare(g))
    else:
        await push(g)
    return {"ok": True}


async def _create_game(cid: int, body: "StartIn", me: Auth) -> Game:
    """Confere tudo e ocupa a vaga numa tacada só (roda sob START_LOCK)."""
    cur = games.get(cid)
    if cur and cur.phase != "end" and me.id != cur.host and in_call(cur.host, cid) and not await can_moderate(cid, me.id):
        raise err(409, "Já tem um jogo rolando. Quem começou (ou quem modera a call) pode encerrar.")
    if throttle(me.id, 2.0):
        raise err(429, "Espere um pouco para começar outro jogo.")
    cls = CLASSES[body.kind]
    players = call_members(cid)
    if len(players) < cls.min_players:
        raise err(400, f"Esse jogo precisa de pelo menos {cls.min_players} pessoas na call.")
    if body.kind == "musica" and (hub.music.get(cid) or {}).get("playing"):
        raise err(400, "Pausem a música da call antes de começar o Adivinhe a música.")
    if body.kind == "mundo" and sum(1 for c, x in games.items() if isinstance(x, Mundo) and c != cid) >= MAX_PHOTO_GAMES:
        raise err(503, "Tem muitas partidas de Onde foi isso? rolando agora. Tentem de novo daqui a pouco.")
    g = cls(cid, me.id, players, await server_of(cid))
    g.public = await channel_open(cid)
    g.setup(body.model_dump())
    if cur:
        cur.retire()
    games[cid] = g
    if isinstance(g, (Musica, Mundo)):
        g.phase = "loading"
    return g


async def _prepare(g: "Musica | Mundo") -> None:
    try:
        async with PREP_SLOTS:  # poucas preparações (buscas e downloads) ao mesmo tempo no servidor
            if games.get(g.cid) is not g:
                return
            await g.prepare()
    except asyncio.CancelledError:
        raise
    except Exception as e:  # noqa: BLE001
        async with g.lock:
            if games.get(g.cid) is g:
                g.phase = "end"
                g.notice = getattr(e, "detail", None) or "Não deu para preparar o jogo agora. Tentem de novo daqui a pouco."
                await push(g)
        return
    async with g.lock:
        if games.get(g.cid) is g:
            g.prep = None
            await g.next_round()
            await push(g)


@router.post("/calls/{channel_id}/minigame/act")
async def act_game(channel_id: str, body: ActIn, me: Auth = CurrentUser) -> dict:
    cid = parse_id(channel_id)
    _must_be_in_call(me, cid)
    g = games.get(cid)
    if not g:
        raise err(404, "Nenhum jogo rolando nesta call.")
    async with g.lock:
        if games.get(cid) is not g:
            raise err(409, "Esse jogo acabou de mudar. Olhe de novo.")
        g.notice = ""
        out = await g.act(me.id, body) or {}
        await push(g)
    return {"ok": True, **out}


@router.delete("/calls/{channel_id}/minigame")
async def end_game(channel_id: str, me: Auth = CurrentUser) -> dict:
    cid = parse_id(channel_id)
    _must_be_in_call(me, cid)
    g = games.get(cid)
    if not g:
        return {"ok": True}
    if me.id != g.host and in_call(g.host, cid) and not await can_moderate(cid, me.id):
        raise err(403, "Só quem começou o jogo (ou quem modera a call) pode encerrar.")
    await finish(cid)
    return {"ok": True}


@router.get("/calls/{channel_id}/minigame/foto/{token}/{n}")
async def game_photo(channel_id: str, token: str, n: int, me: Auth = CurrentUser) -> Response:
    cid = parse_id(channel_id)
    _must_be_in_call(me, cid)
    g = games.get(cid)
    if not isinstance(g, Mundo) or not secrets.compare_digest(token, g.token) or not (1 <= n <= g.round) or n > len(g.images):
        raise err(404, "Foto não encontrada.")
    data, mime = g.images[n - 1]
    return Response(data, media_type=mime, headers={"Cache-Control": "private, max-age=600"})


async def games_cleanup_loop() -> None:
    """Call vazia: o jogo acaba. Também esquece o freio de quem saiu."""
    while True:
        await asyncio.sleep(30)
        for cid in list(games):
            if not call_members(cid):
                await finish(cid)
        now = time.monotonic()
        for uid, t in list(_last_act.items()):
            if now - t > 600:
                _last_act.pop(uid, None)
        for cid, d in list(_laughs.items()):
            if not d or now - max(t for t, _ in d.values()) > 60:
                _laughs.pop(cid, None)
        for uid, t in list(_last_report.items()):
            if now - t > 60:
                _last_report.pop(uid, None)
        for cid, t in list(_last_laugh_clip.items()):
            if now - t > LAUGH_COOLDOWN:
                _last_laugh_clip.pop(cid, None)
        if now - _pruned["music"] > 6 * 3600:
            _pruned["music"] = now
            try:
                from .retro import prune_music_log  # noqa: PLC0415

                await prune_music_log()
            except Exception as e:  # noqa: BLE001
                log.warning("minigames: limpeza do histórico de músicas falhou (%s)", type(e).__name__)


# ------------------------------------------------------------------ clipe de risada
LAUGH_WINDOW = 4.0
LAUGH_COOLDOWN = 90.0
_laughs: dict[int, dict[int, tuple[float, bool]]] = {}
_last_laugh_clip: dict[int, float] = {}
_last_report: dict[int, float] = {}
_pruned: dict[str, float] = {"music": -1e9}


def laugh_allowed(cid: int) -> bool:
    """Clipe de risada só quando TODO MUNDO na call ligou a opção (quem não quer, desliga para a call)."""
    members = hub.voice.get(cid, {})
    if len(members) < 2 or not all(bool(st.get("laugh")) for st in members.values()):
        return False
    # quem entra pela ponte do Discord não tem como aceitar: com gente de lá na call, não clipa
    try:
        from .routes.discord import discord_voice_snapshot  # noqa: PLC0415

        if discord_voice_snapshot([cid]).get(sid(cid)):
            return False
    except Exception:  # noqa: BLE001
        return False
    return True


class LaughIn(BaseModel):
    channel_id: str = Field(max_length=30)
    can_clip: bool = False


@router.post("/voice/risada")
async def laugh(body: LaughIn, me: Auth = CurrentUser) -> dict:
    """O app avisa que a pessoa riu. Duas pessoas diferentes rindo juntas viram um clipe (um só, de um app)."""
    cid = parse_id(body.channel_id)
    _must_be_in_call(me, cid)
    now = time.monotonic()
    if now - _last_report.get(me.id, 0) < 2.0:
        return {"ok": True}
    _last_report[me.id] = now
    if not laugh_allowed(cid):
        _laughs.pop(cid, None)
        return {"ok": True, "off": True}
    d = _laughs.setdefault(cid, {})
    d[me.id] = (now, bool(body.can_clip))
    for uid, (t, _) in list(d.items()):
        if now - t > LAUGH_WINDOW or not in_call(uid, cid):
            d.pop(uid, None)
    if len(d) < 2 or now - _last_laugh_clip.get(cid, -1e9) < LAUGH_COOLDOWN:
        return {"ok": True}
    clippers = sorted(uid for uid, (_, ok) in d.items() if ok and in_call(uid, cid))
    d.clear()
    _last_laugh_clip[cid] = now
    members = call_members(cid)
    await hub.send(members, "risada", {"channel_id": sid(cid), "clip": bool(clippers)})
    if clippers:
        await hub.send([clippers[0]], "risada_clip", {"channel_id": sid(cid)})
    return {"ok": True, "clip": bool(clippers)}
