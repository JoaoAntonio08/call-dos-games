"""Rádio da call: quando a fila acaba, entra sozinha uma música na mesma vibe (como os bots de música do Discord).

Como escolhe, olhando as últimas músicas que tocaram na call:
- todas do mesmo artista  → mais músicas desse artista;
- artistas diferentes     → o gênero/estilo que o YouTube dá para esses vídeos (topicDetails), o mais comum entre eles;
- sem gênero conhecido     → o artista da última música.
Nunca repete o que já tocou ou já está na fila (nem a mesma música com outro título de upload).
Liga e desliga por call com /radio (vem ligado). Precisa de YOUTUBE_API_KEY; sem ela não faz nada.
"""

from __future__ import annotations

import asyncio
import html
import logging
import random
import re
import unicodedata
from collections import Counter, deque

import httpx

from ..core import new_id, pool, settings, sid
from ..realtime import hub

log = logging.getLogger("radio")

HISTORY = 12  # músicas lembradas por call
LOOK_BACK = 5  # quantas das últimas decidem o "clima"
RADIO_NAME = "Rádio da call"

history: dict[int, deque[tuple[str, str, str]]] = {}
off: set[int] = set()
picked: dict[int, str] = {}  # call -> última música que o rádio escolheu (para o "pedido por Rádio da call")
_busy: set[int] = set()

# tópicos do YouTube que não dizem nada sobre o estilo
_GENERIC = {"music", "entertainment", "society", "lifestyle (sociology)", "television program", "film", "hobby", "video game culture"}
# tópicos de região: ajudam a saber "de onde", mas não são o estilo
_REGIONAL = {"music of latin america", "music of asia"}
# os gêneros que o YouTube usa são poucos e largos: o nome que a turma busca
GENRE_PT = {
    "hip hop music": "rap", "pop music": "pop", "rock music": "rock", "electronic music": "música eletrônica",
    "rhythm and blues": "r&b", "soul music": "soul", "reggae": "reggae", "jazz": "jazz", "country music": "sertanejo",
    "christian music": "gospel", "classical music": "música clássica", "independent music": "indie",
}
# o que não é "uma música": mixes, coletâneas, horas seguidas
_NOT_A_SONG = re.compile(
    r"\b(mix|mashup|playlist|coletânea|coletanea|compilation|as melhores|só as|so as|relíquias|reliquias|top \d+|\d+ hours?|\d+ horas?"
    r"|full album|álbum completo|album completo|type beat|sped ?up|slowed|reverb|nightcore|8d|cover|karaok[eê]|instrumental|lyrics? video)\b",
    re.I,
)
_PT = re.compile(r"[ãõçâêôáéíóú]|\b(você|voce|não|nao|meu|minha|pra|amor|de|do|da)\b", re.I)
MAX_SECONDS = 600
_ARTIST_NOISE = re.compile(r"\s*(?:-\s*topic|vevo|official|oficial|tv|channel|canal|music)\s*$", re.I)
_TITLE_NOISE = re.compile(
    r"\((?:[^)]*(?:official|oficial|clipe|video|vídeo|audio|áudio|lyric|letra|visualizer|ao vivo|live)[^)]*)\)|\[[^\]]*\]", re.I
)


def youtube_base() -> str:
    from .musica import YOUTUBE_BASE

    return YOUTUBE_BASE


def remember(channel_id: int, video_id: str, title: str, author: str) -> None:
    h = history.setdefault(channel_id, deque(maxlen=HISTORY))
    if not h or h[-1][0] != video_id:
        h.append((video_id, title or "", author or ""))


def reset(channel_id: int) -> None:
    """A call esvaziou: começa do zero (e ligado) na próxima."""
    history.pop(channel_id, None)
    picked.pop(channel_id, None)
    off.discard(channel_id)


def artist_of(author: str) -> str:
    a = author.strip()
    for _ in range(2):
        a = _ARTIST_NOISE.sub("", a).strip(" -·|")
    return a or author.strip()


def artist_from(title: str, channel: str) -> str:
    """O artista da música. O canal pode ser a gravadora ("30PRAUM"), então o título manda quando é "Artista - Música"."""
    ch = artist_of(channel)
    t = html.unescape(title)
    if ch and ch.lower() in t.lower():
        return ch
    if " - " in t:
        left = re.split(r"\s*(?:,|&|\bx\b|\be\b|\bft\.?|\bfeat\.?)\s*", t.split(" - ", 1)[0].strip(), maxsplit=1, flags=re.I)[0].strip()
        if 0 < len(left) <= 40 and "|" not in left:
            return left
    return ch


def same_song_key(title: str) -> str:
    """Chave para reconhecer a mesma música em uploads diferentes ("Artista - X (Official Video)", "X [Lyrics]")."""
    t = _TITLE_NOISE.sub(" ", html.unescape(title))
    if " - " in t:  # "Artista - Música": fica só a música
        t = t.split(" - ", 1)[1]
    t = re.split(r"\s+(?:ft\.?|feat\.?|part\.?|prod\.?)\s", t, maxsplit=1, flags=re.I)[0]
    t = unicodedata.normalize("NFKD", t).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", " ", t).strip()[:40]


def genre_of(topic_url: str) -> str:
    name = topic_url.rstrip("/").rsplit("/", 1)[-1].replace("_", " ")
    name = re.sub(r"%[0-9A-Fa-f]{2}", "", name).strip()
    return "" if name.lower() in _GENERIC else name


async def _videos_meta(ids: list[str]) -> dict[str, list[str]]:
    """Gêneros (topicDetails) de cada vídeo. Custa 1 unidade da cota por chamada."""
    if not ids:
        return {}
    try:
        async with httpx.AsyncClient(timeout=6) as c:
            r = await c.get(
                youtube_base() + "/youtube/v3/videos",
                params={"part": "topicDetails", "id": ",".join(ids[:50]), "key": settings.youtube_key},
            )
        if r.status_code != 200:
            return {}
        out: dict[str, list[str]] = {}
        for it in r.json().get("items") or []:
            topics = (it.get("topicDetails") or {}).get("topicCategories") or []
            out[str(it.get("id"))] = [g for g in (genre_of(t) for t in topics) if g]
        return out
    except Exception:
        return {}


def _seconds(iso: str) -> int:
    m = re.fullmatch(r"P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?", iso or "")
    if not m:
        return 0
    d, h, mi, se = (int(x or 0) for x in m.groups())
    return d * 86400 + h * 3600 + mi * 60 + se


async def _durations(ids: list[str]) -> dict[str, int]:
    """Duração em segundos de cada vídeo (1 unidade da cota)."""
    if not ids:
        return {}
    try:
        async with httpx.AsyncClient(timeout=6) as c:
            r = await c.get(
                youtube_base() + "/youtube/v3/videos",
                params={"part": "contentDetails", "id": ",".join(ids[:50]), "key": settings.youtube_key},
            )
        if r.status_code != 200:
            return {}
        return {str(it.get("id")): _seconds((it.get("contentDetails") or {}).get("duration", "")) for it in r.json().get("items") or []}
    except Exception:
        return {}


async def _search(q: str, n: int = 15, lang: str = "") -> list[tuple[str, str, str]]:
    """Músicas (não mixes) para a busca: (id, título, canal). Custa ~101 unidades da cota."""
    try:
        params = {
            "part": "snippet", "type": "video", "videoCategoryId": "10", "videoEmbeddable": "true",
            "maxResults": str(n), "regionCode": "BR", "q": q, "key": settings.youtube_key,
        }
        if lang:
            params["relevanceLanguage"] = lang
        async with httpx.AsyncClient(timeout=6) as c:
            r = await c.get(youtube_base() + "/youtube/v3/search", params=params)
        if r.status_code != 200:
            return []
        out = []
        for it in r.json().get("items") or []:
            vid = (it.get("id") or {}).get("videoId") or ""
            sn = it.get("snippet") or {}
            title = html.unescape(str(sn.get("title", "")))[:200]
            if len(vid) == 11 and sn.get("liveBroadcastContent", "none") == "none" and not _NOT_A_SONG.search(title):
                out.append((vid, title, html.unescape(str(sn.get("channelTitle", "")))[:100]))
        lengths = await _durations([v for v, _, _ in out])
        if lengths:  # sem a duração (erro), fica com o que tem
            out = [r for r in out if 60 <= lengths.get(r[0], 0) <= MAX_SECONDS]
        return out
    except Exception:
        return []


def in_portuguese(titles: list[str]) -> bool:
    # título curto de música brasileira muitas vezes não tem acento ("Quer Voar"): 1 em 3 já basta
    return sum(1 for t in titles if _PT.search(t)) * 3 >= len(titles) > 0


async def plan(channel_id: int) -> tuple[str, str] | None:
    """(busca, modo) a partir do que tocou. modo: "artista" ou "estilo"."""
    h = list(history.get(channel_id) or [])[-LOOK_BACK:]
    if not h:
        return None
    artists = [x for x in (artist_from(t, a) for _, t, a in h) if x]
    by_name = {a.lower(): a for a in artists}  # sem repetir, mantendo a ordem (o último ganha a grafia)
    names = list(by_name.values())
    last_artist = artists[-1] if artists else ""
    if len(names) <= 1:
        return (last_artist, "artista") if last_artist else None
    meta = await _videos_meta([v for v, _, _ in h])
    genres = Counter(g for v, _, _ in h for g in dict.fromkeys(meta.get(v, [])) if g.lower() not in _REGIONAL)
    if genres:
        top = genres.most_common(1)[0][0]
        name = GENRE_PT.get(top.lower(), top)
        style = f"{name} nacional" if in_portuguese([t for _, t, _ in h]) else name
        # o gênero sozinho é largo demais ("pop" vira K-pop): os artistas que tocaram seguram a vibe
        return f"{style} {' '.join(names[-3:])}", "estilo"
    return (last_artist, "artista") if last_artist else None


def choose(
    results: list[tuple[str, str, str]], seen_ids: set[str], seen_titles: set[str], mode: str, recent_artists: set[str]
) -> tuple[str, str, str] | None:
    def repeated(title: str) -> bool:
        k = same_song_key(title)
        # "novo balanco" e "novo balanco i ecoando amazon music" são a mesma música
        return any(k == s or (min(len(k), len(s)) >= 6 and (k.startswith(s) or s.startswith(k))) for s in seen_titles)

    fresh = [r for r in results if r[0] not in seen_ids and not repeated(r[1])]
    if mode == "estilo":
        # na busca por estilo, prefere variar de artista
        other = [r for r in fresh if artist_from(r[1], r[2]).lower() not in recent_artists]
        fresh = other or fresh
    if not fresh:
        return None
    return random.choice(fresh[:5])


async def next_song(channel_id: int) -> tuple[str, str, str] | None:
    p = await plan(channel_id)
    if not p:
        return None
    query, mode = p
    rows = await pool().fetch("SELECT video_id, title FROM queue_items WHERE channel_id = $1", channel_id)
    h = list(history.get(channel_id) or [])
    seen_ids = {v for v, _, _ in h} | {r["video_id"] for r in rows}
    seen_titles = {same_song_key(t) for _, t, _ in h} | {same_song_key(r["title"]) for r in rows}
    recent = {artist_from(t, a).lower() for _, t, a in h[-LOOK_BACK:]}
    lang = "pt" if in_portuguese([t for _, t, _ in h[-LOOK_BACK:]]) else ""
    return choose(await _search(query, lang=lang), seen_ids, seen_titles, mode, recent)


async def fill_if_empty(channel_id: int) -> None:
    """Fila vazia e alguém na call: põe a próxima na mesma vibe (vira o "a seguir")."""
    if channel_id in off or channel_id in _busy or not settings.youtube_key or not hub.voice.get(channel_id):
        return
    _busy.add(channel_id)
    try:
        if await pool().fetchval("SELECT count(*) FROM queue_items WHERE channel_id = $1", channel_id):
            return
        found = await next_song(channel_id)
        if not found or not hub.voice.get(channel_id) or channel_id in off:
            return
        vid, title, author = found
        picked[channel_id] = vid
        await pool().execute(
            "INSERT INTO queue_items (id, channel_id, video_id, start_at, title, author, added_by) VALUES ($1,$2,$3,0,$4,$5,NULL)",
            new_id(), channel_id, vid, title, author,
        )
        from .extras import announce_queue

        await announce_queue(channel_id)
        await hub.send(
            list(hub.voice.get(channel_id, {}).keys()),
            "music_added",
            {"channel_id": sid(channel_id), "title": title or "Música", "by": RADIO_NAME, "position": 1, "user_id": None, "radio": True},
        )
    except Exception as e:
        log.warning("rádio: não deu para escolher a próxima (%s)", type(e).__name__)
    finally:
        _busy.discard(channel_id)


def schedule_fill(channel_id: int) -> None:
    try:
        asyncio.get_running_loop().create_task(fill_if_empty(channel_id))
    except RuntimeError:
        pass  # fora do loop (testes)


async def radio_command(args: str, channel_id: int) -> str:
    a = args.strip().lower()
    turn_on = a in ("ligar", "on", "liga", "sim") or (not a and channel_id in off)
    if turn_on:
        off.discard(channel_id)
        if hub.music.get(channel_id):
            schedule_fill(channel_id)
        return "📻 Rádio da call ligado: quando a fila acabar, entra uma música na mesma vibe (mesmo artista, ou o estilo do que vocês estão ouvindo). /radio de novo desliga."
    off.add(channel_id)
    removed = await pool().fetch("DELETE FROM queue_items WHERE channel_id = $1 AND added_by IS NULL RETURNING id", channel_id)
    if removed:
        from .extras import announce_queue

        await announce_queue(channel_id)
    return "📻 Rádio da call desligado: quando a fila acabar, a música para. /radio liga de novo."
