"""Conquistas: horas em call, transmitindo e assistindo tela, e servidores criados liberam enfeites de perfil.

Quem conta é o servidor, a partir de quem está em cada call (hub.voice) e de quem está transmitindo (stream).
O app de ninguém manda número, então não dá para forjar. Call com uma pessoa só não conta (senão era só
deixar o PC ligado numa call vazia).

Cada etapa libera um enfeite. A pessoa escolhe o que mostra em Perfil (users.flair):
  name   nome em degradê ou RGB
  ring   aro em volta da foto
  banner brilho que passa no banner
  plate  placa na vitrine do perfil
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
from typing import Any

from fastapi import APIRouter

from .core import Auth, CurrentUser, pool
from .realtime import hub

log = logging.getLogger("conquistas")
router = APIRouter()

TICK = 60.0  # de quanto em quanto tempo soma
MAX_STEP = 2 * TICK  # servidor travou ou dormiu: não soma o buraco inteiro

# trilha -> etapas (quanto precisa, enfeite que libera). "h" é em horas.
TRACKS: list[dict[str, Any]] = [
    {"id": "call", "name": "Tempo em call", "unit": "h", "steps": [(5, "ring:pulse"), (10, "name:gradient"), (25, "banner:shine"), (50, "name:rgb")]},
    {"id": "share", "name": "Transmitindo tela", "unit": "h", "steps": [(1, "plate:live"), (10, "ring:live"), (25, "plate:streamer")]},
    {"id": "watch", "name": "Assistindo a tela dos outros", "unit": "h", "steps": [(3, "plate:crowd"), (25, "plate:crowd_holo")]},
    {"id": "servers", "name": "Servidores criados", "unit": "", "steps": [(1, "plate:founder"), (3, "plate:founder_gold")]},
]
REWARDS = {
    "ring:pulse": "Aro que pulsa",
    "name:gradient": "Nome em degradê",
    "banner:shine": "Banner com brilho",
    "name:rgb": "Nome RGB",
    "plate:live": "Placa Na tela",
    "ring:live": "Aro Ao vivo",
    "plate:streamer": "Placa holográfica Streamer",
    "plate:crowd": "Placa Plateia",
    "plate:crowd_holo": "Placa holográfica Plateia fiel",
    "plate:founder": "Placa Fundador",
    "plate:founder_gold": "Placa Fundador dourada",
    "plate:coruja": "Placa Coruja",
    "plate:maratona": "Placa Maratonista",
    "plate:impostor": "Placa Mestre do disfarce",
    "plate:ouvido": "Placa Ouvido absoluto",
    "plate:globo": "Placa Globo na mão",
}

# conquistas secretas: não aparecem até alguém liberar. Tudo é medido aqui no servidor.
# código -> (enfeite, nome, como liberou)
SECRETS: dict[str, tuple[str, str, str]] = {
    "coruja": ("plate:coruja", "Coruja da madrugada", "Esteve numa call com a turma entre 3h e 5h da manhã."),
    "maratona": ("plate:maratona", "Maratonista", "Ficou 6 horas seguidas na mesma call."),
    "impostor": ("plate:impostor", "Mestre do disfarce", "Venceu 3 vezes como impostor."),
    "ouvido": ("plate:ouvido", "Ouvido absoluto", "Acertou 15 músicas no Adivinhe a música."),
    "globo": ("plate:globo", "Globo na mão", "Cravou o lugar da foto no Onde foi isso?"),
}
# contador -> (quanto precisa, conquista secreta)
COUNTERS: dict[str, tuple[int, str]] = {"impostor": (3, "impostor"), "ouvido": (15, "ouvido"), "globo": (1, "globo")}
BRT_OFFSET = -3 * 3600  # Brasília (sem horário de verão desde 2019)
SLOTS = ("name", "ring", "banner", "plate")


def unlocked_from(values: dict[str, float]) -> list[str]:
    """Os enfeites liberados para esses números (na ordem das trilhas)."""
    return [reward for t in TRACKS for at, reward in t["steps"] if values.get(t["id"], 0) >= at]


async def values_of(user_id: int) -> dict[str, float]:
    row = await pool().fetchrow("SELECT call_seconds, share_seconds, watch_seconds FROM user_stats WHERE user_id = $1", user_id)
    servers = await pool().fetchval("SELECT count(*) FROM servers WHERE owner_id = $1", user_id)
    # horas exatas: arredondar aqui liberava a etapa de 5 h com 4h57
    h = lambda s: (s or 0) / 3600  # noqa: E731
    return {
        "call": h(row and row["call_seconds"]),
        "share": h(row and row["share_seconds"]),
        "watch": h(row and row["watch_seconds"]),
        "servers": float(servers or 0),
    }


def clean_flair(raw: Any, unlocked: list[str]) -> dict[str, str]:
    """Só fica o que a pessoa já liberou e no lugar certo (nome com efeito de nome, placa com placa...)."""
    data = raw if isinstance(raw, dict) else {}
    out: dict[str, str] = {}
    for slot in SLOTS:
        v = str(data.get(slot) or "")
        if v and f"{slot}:{v}" in unlocked:
            out[slot] = v
    return out


def parse_flair(raw: Any) -> dict[str, str]:
    if isinstance(raw, str):
        try:
            raw = json.loads(raw)
        except ValueError:
            return {}
    return {k: str(v) for k, v in (raw or {}).items() if k in SLOTS and v} if isinstance(raw, dict) else {}


@router.get("/me/conquistas")
async def my_achievements(me: Auth = CurrentUser) -> dict:
    values = await values_of(me.id)
    got = await secrets_of(me.id)
    unlocked = unlocked_from(values) + [SECRETS[c][0] for c in got]
    flair = parse_flair(await pool().fetchval("SELECT flair FROM users WHERE id = $1", me.id))
    tracks = [
        {
            "id": t["id"],
            "name": t["name"],
            "unit": t["unit"],
            "value": round(values[t["id"]], 1) if t["unit"] else values[t["id"]],
            "max": t["steps"][-1][0],
            "steps": [{"at": at, "reward": r, "label": REWARDS[r], "unlocked": values[t["id"]] >= at} for at, r in t["steps"]],
        }
        for t in TRACKS
    ]
    hidden = [
        {"code": c, "name": name, "how": how, "reward": reward, "label": REWARDS[reward], "unlocked": True}
        for c, (reward, name, how) in SECRETS.items()
        if c in got
    ]
    return {"tracks": tracks, "unlocked": unlocked, "flair": flair, "secrets": hidden, "secrets_total": len(SECRETS)}


async def secrets_of(user_id: int) -> list[str]:
    rows = await pool().fetch("SELECT code FROM user_secrets WHERE user_id = $1", user_id)
    return [r["code"] for r in rows if r["code"] in SECRETS]


async def unlocked_for(user_id: int) -> list[str]:
    """Tudo que a pessoa pode usar: trilhas + secretas."""
    return unlocked_from(await values_of(user_id)) + [SECRETS[c][0] for c in await secrets_of(user_id)]


_known_secrets: set[tuple[int, str]] = set()


async def unlock_secret(user_id: int, code: str) -> bool:
    if code not in SECRETS or (user_id, code) in _known_secrets:
        return False
    new = await pool().fetchval(
        "INSERT INTO user_secrets (user_id, code) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING code", user_id, code
    )
    _known_secrets.add((user_id, code))
    if new:
        reward, name, _ = SECRETS[code]
        await hub.send([user_id], "conquista", {"reward": reward, "label": f"conquista secreta “{name}” ({REWARDS[reward]})"})
    return bool(new)


async def bump(user_id: int, key: str, n: int = 1) -> int:
    """Soma num contador (jogos) e libera a secreta ligada a ele quando chega lá."""
    total = await pool().fetchval(
        """INSERT INTO user_counters (user_id, key, n) VALUES ($1, $2, $3)
           ON CONFLICT (user_id, key) DO UPDATE SET n = user_counters.n + EXCLUDED.n RETURNING n""",
        user_id, key, n,
    )
    rule = COUNTERS.get(key)
    if rule and int(total or 0) >= rule[0]:
        await unlock_secret(user_id, rule[1])
    return int(total or 0)


def month_of(ts: float | None = None) -> str:
    t = time.gmtime((ts or time.time()) + BRT_OFFSET)
    return f"{t.tm_year:04d}-{t.tm_mon:02d}"


async def won_game(server_id: int | None, user_id: int) -> None:
    if not server_id:
        return
    await pool().execute(
        """INSERT INTO stats_monthly (server_id, user_id, month, games_won) VALUES ($1, $2, $3, 1)
           ON CONFLICT (server_id, user_id, month) DO UPDATE SET games_won = stats_monthly.games_won + 1""",
        server_id, user_id, month_of(),
    )


# ------------------------------------------------------------------ contagem
def credits(voice: dict[int, dict[int, dict]], seconds: float) -> dict[int, list[float]]:
    """Quanto somar para cada pessoa agora: [call, transmitindo, assistindo]."""
    out: dict[int, list[float]] = {}
    for members in voice.values():
        if len(members) < 2:
            continue
        streamers = {uid for uid, st in members.items() if st.get("stream")}
        for uid in members:
            c = out.setdefault(uid, [0.0, 0.0, 0.0])
            c[0] += seconds
            if uid in streamers:
                c[1] += seconds
            if streamers - {uid}:
                c[2] += seconds
    return out


async def add_time(per_user: dict[int, list[float]]) -> list[tuple[int, list[str]]]:
    """Soma no banco e devolve quem liberou enfeite novo agora."""
    news: list[tuple[int, list[str]]] = []
    for uid, (c, s, w) in per_user.items():
        row = await pool().fetchrow(
            """INSERT INTO user_stats (user_id, call_seconds, share_seconds, watch_seconds) VALUES ($1, $2, $3, $4)
               ON CONFLICT (user_id) DO UPDATE SET call_seconds = user_stats.call_seconds + EXCLUDED.call_seconds,
                 share_seconds = user_stats.share_seconds + EXCLUDED.share_seconds,
                 watch_seconds = user_stats.watch_seconds + EXCLUDED.watch_seconds
               RETURNING call_seconds, share_seconds, watch_seconds""",
            uid, int(c), int(s), int(w),
        )
        if not row:
            continue
        after = {"call": row["call_seconds"] / 3600, "share": row["share_seconds"] / 3600, "watch": row["watch_seconds"] / 3600}
        before = {"call": (row["call_seconds"] - int(c)) / 3600, "share": (row["share_seconds"] - int(s)) / 3600, "watch": (row["watch_seconds"] - int(w)) / 3600}
        fresh = [r for r in unlocked_from(after) if r not in unlocked_from(before)]
        if fresh:
            news.append((uid, fresh))
    return news


async def announce(user_id: int, rewards: list[str]) -> None:
    for r in rewards:
        await hub.send([user_id], "conquista", {"reward": r, "label": REWARDS.get(r, r)})


async def server_created(user_id: int) -> None:
    """Chamado ao criar servidor: a placa Fundador chega na hora."""
    n = await pool().fetchval("SELECT count(*) FROM servers WHERE owner_id = $1", user_id)
    fresh = [r for at, r in TRACKS[3]["steps"] if n == at]
    if fresh:
        await announce(user_id, fresh)


async def stats_loop() -> None:
    last = time.monotonic()
    while True:
        await asyncio.sleep(TICK)
        now = time.monotonic()
        step, last = min(now - last, MAX_STEP), now
        try:
            for uid, fresh in await add_time(credits(hub.voice, step)):
                await announce(uid, fresh)
        except Exception as e:  # noqa: BLE001
            log.warning("conquistas: não deu para somar o tempo (%s)", type(e).__name__)
        try:
            await add_month(step)
            for uid, code in night_and_marathon(hub.voice, time.time()):
                await unlock_secret(uid, code)
        except Exception as e:  # noqa: BLE001
            log.warning("conquistas: não deu para somar o mês (%s)", type(e).__name__)


def night_and_marathon(voice: dict[int, dict[int, dict]], now: float) -> list[tuple[int, str]]:
    """Quem ganha Coruja (call com mais gente entre 3h e 5h de Brasília) e Maratonista (6 h seguidas)."""
    hour = time.gmtime(now + BRT_OFFSET).tm_hour
    out: list[tuple[int, str]] = []
    for members in voice.values():
        if len(members) < 2:
            continue
        for uid, st in members.items():
            if 3 <= hour < 5:
                out.append((uid, "coruja"))
            since = st.get("since")
            if isinstance(since, (int, float)) and now * 1000 - since >= 6 * 3600 * 1000:
                out.append((uid, "maratona"))
    return out


_server_of_channel: dict[int, tuple[int | None, bool, float]] = {}
CHANNEL_CACHE_SECONDS = 300


async def _public_server_of(cid: int) -> int | None:
    """Servidor da call, mas só se ela for aberta a todos (call com cargo na visão não entra na retrospectiva)."""
    now = time.monotonic()
    hit = _server_of_channel.get(cid)
    if not hit or now - hit[2] > CHANNEL_CACHE_SECONDS:
        row = await pool().fetchrow("SELECT server_id, cardinality(view_roles) = 0 AS open FROM channels WHERE id = $1", cid)
        hit = (row["server_id"] if row else None, bool(row and row["open"]), now)
        _server_of_channel[cid] = hit
    return hit[0] if hit[1] else None


async def add_month(seconds: float) -> None:
    """Os mesmos minutos, separados por servidor e mês: base da retrospectiva (só calls abertas a todos)."""
    month = month_of()
    for cid in [c for c in _server_of_channel if c not in hub.voice]:
        _server_of_channel.pop(cid, None)
    for cid, members in list(hub.voice.items()):
        server_id = await _public_server_of(cid)
        if not server_id:
            continue
        for uid, (c, sh, w) in credits({cid: members}, seconds).items():
            await pool().execute(
                """INSERT INTO stats_monthly (server_id, user_id, month, call_seconds, share_seconds, watch_seconds)
                   VALUES ($1, $2, $3, $4, $5, $6)
                   ON CONFLICT (server_id, user_id, month) DO UPDATE SET
                     call_seconds = stats_monthly.call_seconds + EXCLUDED.call_seconds,
                     share_seconds = stats_monthly.share_seconds + EXCLUDED.share_seconds,
                     watch_seconds = stats_monthly.watch_seconds + EXCLUDED.watch_seconds""",
                server_id, uid, month, int(c), int(sh), int(w),
            )
