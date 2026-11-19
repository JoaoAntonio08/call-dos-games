"""Noite da turma: evento marcado do servidor (ex.: toda sexta 21h).

- Antes de começar: lembrete para todo mundo do servidor (aviso no app + mensagem no canal de texto).
- Na hora: chama a turma para a call (como um hype) e quem entra pelo aviso já encontra o vídeo/música do evento tocando.
- Durante: conta quanto tempo cada um ficou na call; no fim manda o resumo e a presença vai para o Hall da presença.
- Semanal: depois de acabar, pula para a semana seguinte sozinho.
"""

from __future__ import annotations

import asyncio
import logging
import re
import time
from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import APIRouter
from pydantic import BaseModel

from ..core import Auth, CurrentUser, env, err, new_id, parse_id, pool, sid
from ..realtime import hub
from .servers import require_admin, require_member

router = APIRouter()
log = logging.getLogger("cdg.noites")

ACTIVITIES = {"", "watch", "dj", "jogo", "papo"}
YOUTUBE = re.compile(r"^https://(www\.|m\.|music\.)?(youtube\.com|youtu\.be)/[A-Za-z0-9_\-?=&/.%]+$")
# a partir de quanto tempo na call conta como "foi na noite"
# (as duas variáveis de ambiente só existem para testes rápidos; em produção ficam no padrão)
MIN_PRESENCE = max(1, int(env("NOITES_MIN_PRESENCE", "600")))
TICK = max(1, int(env("NOITES_TICK", "20")))


class EventIn(BaseModel):
    title: str
    description: str = ""
    starts_at: datetime
    duration_min: int = 180
    weekly: bool = False
    voice_channel_id: str
    text_channel_id: str | None = None
    activity: str = ""
    media_url: str = ""
    remind_min: int = 30


class RsvpIn(BaseModel):
    status: str | None = None  # vou | talvez | nao | None (tirar)


def _iso(v: Any) -> str | None:
    return v.isoformat() if v else None


async def _channels_ok(server_id: int, body: EventIn) -> tuple[int, int | None]:
    voice = parse_id(body.voice_channel_id)
    if not await pool().fetchval("SELECT 1 FROM channels WHERE id = $1 AND server_id = $2 AND type = 'voice'", voice, server_id):
        raise err(400, "Escolha uma sala de voz deste servidor.")
    text = parse_id(body.text_channel_id) if body.text_channel_id else None
    if text is None:
        text = await pool().fetchval("SELECT id FROM channels WHERE server_id = $1 AND type = 'text' ORDER BY position, id LIMIT 1", server_id)
    elif not await pool().fetchval("SELECT 1 FROM channels WHERE id = $1 AND server_id = $2 AND type = 'text'", text, server_id):
        raise err(400, "Escolha um canal de texto deste servidor.")
    return voice, text


def _clean(body: EventIn) -> dict:
    title = body.title.strip()
    if not 2 <= len(title) <= 80:
        raise err(400, "O nome da noite precisa ter de 2 a 80 letras.")
    if body.activity not in ACTIVITIES:
        raise err(400, "Atividade inválida.")
    url = body.media_url.strip()
    if url and not YOUTUBE.match(url):
        raise err(400, "O vídeo ou a música precisa ser um link do YouTube.")
    if body.starts_at.tzinfo is None:
        raise err(400, "Horário sem fuso.")
    return {
        "title": title,
        "description": body.description.strip()[:500],
        "starts_at": body.starts_at.astimezone(timezone.utc),
        "duration_min": max(30, min(12 * 60, body.duration_min)),
        "weekly": body.weekly,
        "activity": body.activity,
        "media_url": url,
        "remind_min": max(0, min(24 * 60, body.remind_min)),
    }


async def _event_out(r: Any, viewer: int) -> dict:
    rs = await pool().fetch("SELECT user_id, status FROM event_rsvps WHERE event_id = $1", r["id"])
    now = datetime.now(timezone.utc)
    end = r["starts_at"] + timedelta(minutes=r["duration_min"])
    return {
        "id": sid(r["id"]),
        "server_id": sid(r["server_id"]),
        "title": r["title"],
        "description": r["description"],
        "starts_at": _iso(r["starts_at"]),
        "ends_at": _iso(end),
        "duration_min": r["duration_min"],
        "weekly": r["weekly"],
        "voice_channel_id": sid(r["voice_channel_id"]) if r["voice_channel_id"] else None,
        "text_channel_id": sid(r["text_channel_id"]) if r["text_channel_id"] else None,
        "activity": r["activity"],
        "media_url": r["media_url"],
        "remind_min": r["remind_min"],
        "live": r["starts_at"] <= now < end,
        "rsvps": [{"user_id": sid(x["user_id"]), "status": x["status"]} for x in rs],
        "me": next((x["status"] for x in rs if x["user_id"] == viewer), None),
    }


async def _members(server_id: int) -> list[int]:
    return [r["user_id"] for r in await pool().fetch("SELECT user_id FROM members WHERE server_id = $1", server_id)]


async def _changed(server_id: int) -> None:
    await hub.send(await _members(server_id), "events_changed", {"server_id": sid(server_id)})


async def _event_admin(event_id: str, user_id: int) -> Any:
    r = await pool().fetchrow("SELECT * FROM server_events WHERE id = $1", parse_id(event_id))
    if not r:
        raise err(404, "Noite não encontrada.")
    await require_admin(r["server_id"], user_id)
    return r


@router.get("/servers/{server_id}/noites")
async def list_events(server_id: str, me: Auth = CurrentUser) -> dict:
    s = parse_id(server_id)
    await require_member(s, me.id)
    rows = await pool().fetch("SELECT * FROM server_events WHERE server_id = $1 ORDER BY starts_at", s)
    ranking = await pool().fetch(
        """SELECT user_id, count(*) AS nights, sum(seconds) AS seconds FROM event_attendance
           WHERE server_id = $1 AND seconds >= $2 GROUP BY user_id ORDER BY nights DESC, seconds DESC LIMIT 20""",
        s, MIN_PRESENCE,
    )
    recent = await pool().fetch(
        """SELECT night, max(title) AS title, array_agg(user_id ORDER BY seconds DESC) AS people FROM event_attendance
           WHERE server_id = $1 AND seconds >= $2 GROUP BY night ORDER BY night DESC LIMIT 6""",
        s, MIN_PRESENCE,
    )
    return {
        "events": [await _event_out(r, me.id) for r in rows],
        "ranking": [{"user_id": sid(r["user_id"]), "nights": r["nights"], "seconds": r["seconds"]} for r in ranking],
        "recent": [{"night": _iso(r["night"]), "title": r["title"], "people": [sid(u) for u in r["people"]]} for r in recent],
    }


@router.post("/servers/{server_id}/noites")
async def create_event(server_id: str, body: EventIn, me: Auth = CurrentUser) -> dict:
    s = parse_id(server_id)
    await require_admin(s, me.id)
    if await pool().fetchval("SELECT count(*) FROM server_events WHERE server_id = $1", s) >= 20:
        raise err(400, "Já tem noites demais marcadas (máximo 20).")
    v = _clean(body)
    if v["starts_at"] + timedelta(minutes=v["duration_min"]) < datetime.now(timezone.utc):
        raise err(400, "Esse horário já passou.")
    voice, text = await _channels_ok(s, body)
    eid = new_id()
    r = await pool().fetchrow(
        """INSERT INTO server_events (id, server_id, title, description, starts_at, duration_min, weekly, voice_channel_id, text_channel_id,
                                      activity, media_url, remind_min, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *""",
        eid, s, v["title"], v["description"], v["starts_at"], v["duration_min"], v["weekly"], voice, text,
        v["activity"], v["media_url"], v["remind_min"], me.id,
    )
    await pool().execute("INSERT INTO event_rsvps (event_id, user_id, status) VALUES ($1, $2, 'vou') ON CONFLICT DO NOTHING", eid, me.id)
    await _changed(s)
    return await _event_out(r, me.id)


@router.patch("/noites/{event_id}")
async def update_event(event_id: str, body: EventIn, me: Auth = CurrentUser) -> dict:
    old = await _event_admin(event_id, me.id)
    v = _clean(body)
    voice, text = await _channels_ok(old["server_id"], body)
    r = await pool().fetchrow(
        """UPDATE server_events SET title=$2, description=$3, starts_at=$4, duration_min=$5, weekly=$6, voice_channel_id=$7,
               text_channel_id=$8, activity=$9, media_url=$10, remind_min=$11 WHERE id = $1 RETURNING *""",
        old["id"], v["title"], v["description"], v["starts_at"], v["duration_min"], v["weekly"], voice, text, v["activity"], v["media_url"], v["remind_min"],
    )
    await _changed(old["server_id"])
    return await _event_out(r, me.id)


@router.delete("/noites/{event_id}")
async def delete_event(event_id: str, me: Auth = CurrentUser) -> dict:
    old = await _event_admin(event_id, me.id)
    await pool().execute("DELETE FROM server_events WHERE id = $1", old["id"])
    await _changed(old["server_id"])
    return {"ok": True}


@router.put("/noites/{event_id}/rsvp")
async def rsvp(event_id: str, body: RsvpIn, me: Auth = CurrentUser) -> dict:
    r = await pool().fetchrow("SELECT * FROM server_events WHERE id = $1", parse_id(event_id))
    if not r:
        raise err(404, "Noite não encontrada.")
    await require_member(r["server_id"], me.id)
    if body.status is None:
        await pool().execute("DELETE FROM event_rsvps WHERE event_id = $1 AND user_id = $2", r["id"], me.id)
    elif body.status in ("vou", "talvez", "nao"):
        await pool().execute(
            """INSERT INTO event_rsvps (event_id, user_id, status) VALUES ($1,$2,$3)
               ON CONFLICT (event_id, user_id) DO UPDATE SET status = EXCLUDED.status""",
            r["id"], me.id, body.status,
        )
    else:
        raise err(400, "Resposta inválida.")
    await _changed(r["server_id"])
    return await _event_out(r, me.id)


# ------------------------------------------------------------------ o relógio das noites


def _when(minutes: int) -> str:
    if minutes >= 60 and minutes % 60 == 0:
        h = minutes // 60
        return f"{h} hora" + ("s" if h > 1 else "")
    return f"{minutes} min"


def _dur(seconds: int) -> str:
    m = seconds // 60
    return f"{m // 60}h{m % 60:02d}" if m >= 60 else f"{m} min"


async def _say(r: Any, text: str) -> None:
    if not r["text_channel_id"]:
        return
    from .messages import post_webhook_message

    await post_webhook_message(r["text_channel_id"], r["id"], "Noite da turma", text)


async def _alert(r: Any, kind: str) -> None:
    server = await pool().fetchrow("SELECT name FROM servers WHERE id = $1", r["server_id"])
    voice = await pool().fetchval("SELECT name FROM channels WHERE id = $1", r["voice_channel_id"]) if r["voice_channel_id"] else None
    going = await pool().fetchval("SELECT count(*) FROM event_rsvps WHERE event_id = $1 AND status = 'vou'", r["id"])
    data = {
        "id": sid(r["id"]),
        "server_id": sid(r["server_id"]),
        "server_name": server["name"] if server else "",
        "title": r["title"],
        "starts_at": _iso(r["starts_at"]),
        "channel_id": sid(r["voice_channel_id"]) if r["voice_channel_id"] else None,
        "channel_name": voice or "",
        "activity": r["activity"],
        "media_url": r["media_url"],
        "going": going,
        "in_call": len(hub.voice.get(r["voice_channel_id"], {})) if r["voice_channel_id"] else 0,
    }
    # quem respondeu "não vou" não leva lembrete (mas fica sabendo que começou pelo chat)
    no = {x["user_id"] for x in await pool().fetch("SELECT user_id FROM event_rsvps WHERE event_id = $1 AND status = 'nao'", r["id"])}
    await hub.send([u for u in await _members(r["server_id"]) if u not in no], kind, data)
    sala = f"🔊 {voice}" if voice else "a call"
    if kind == "event_reminder":
        await _say(r, f"⏰ Daqui a {_when(r['remind_min'])}: **{r['title']}** em {sala}." + (f" {going} já confirmaram." if going else " Bora?"))
    else:
        extra = {"watch": " O vídeo já começa quando a turma entrar.", "dj": " A música já começa quando a turma entrar."}.get(r["activity"], "")
        await _say(r, f"🎉 Começou: **{r['title']}**! Entrem em {sala}.{extra}")


_last_tick: dict[int, float] = {}


async def _count_presence(r: Any) -> None:
    now = time.monotonic()
    last = _last_tick.get(r["id"])
    _last_tick[r["id"]] = now
    if last is None or not r["voice_channel_id"]:
        return
    secs = int(min(now - last, TICK * 3))
    people = list(hub.voice.get(r["voice_channel_id"], {}).keys())
    if not people or secs <= 0:
        return
    await pool().executemany(
        """INSERT INTO event_attendance (server_id, night, user_id, event_id, title, seconds) VALUES ($1,$2,$3,$4,$5,$6)
           ON CONFLICT (server_id, night, user_id) DO UPDATE SET seconds = event_attendance.seconds + EXCLUDED.seconds""",
        [(r["server_id"], r["started_for"], uid, r["id"], r["title"], secs) for uid in people],
    )


async def _finish(r: Any) -> None:
    _last_tick.pop(r["id"], None)
    night = r["started_for"]
    # aconteceu nesta rodada (se mudaram o horário com a noite rolando, vale a hora em que começou)
    if night is not None and night >= r["starts_at"]:
        rows = await pool().fetch(
            """SELECT a.user_id, a.seconds, u.display_name FROM event_attendance a JOIN users u ON u.id = a.user_id
               WHERE a.server_id = $1 AND a.night = $2 AND a.seconds >= $3 ORDER BY a.seconds DESC""",
            r["server_id"], night, MIN_PRESENCE,
        )
        if rows:
            names = ", ".join(x["display_name"] for x in rows[:12]) + (f" e mais {len(rows) - 12}" if len(rows) > 12 else "")
            top = rows[0]
            await _say(
                r,
                f"🏁 Fim da **{r['title']}**: {len(rows)} {'pessoa apareceu' if len(rows) == 1 else 'pessoas apareceram'} ({names}). "
                f"Quem mais ficou: {top['display_name']} ({_dur(top['seconds'])}). A presença foi para o Hall da presença.",
            )
        else:
            await _say(r, f"🏁 A **{r['title']}** acabou sem ninguém na call. Fica para a próxima!")
    if r["weekly"]:
        nxt = r["starts_at"]
        now = datetime.now(timezone.utc)
        while nxt + timedelta(minutes=r["duration_min"]) <= now:
            nxt += timedelta(days=7)
        await pool().execute("UPDATE server_events SET starts_at = $2 WHERE id = $1", r["id"], nxt)
        await pool().execute("DELETE FROM event_rsvps WHERE event_id = $1", r["id"])
    else:
        await pool().execute("DELETE FROM server_events WHERE id = $1", r["id"])
    await _changed(r["server_id"])


async def tick() -> None:
    now = datetime.now(timezone.utc)
    rows = await pool().fetch(
        "SELECT * FROM server_events WHERE starts_at - make_interval(mins => remind_min) <= $1 OR starts_at <= $1", now
    )
    for r in rows:
        try:
            start, end = r["starts_at"], r["starts_at"] + timedelta(minutes=r["duration_min"])
            if now >= end:
                await _finish(r)
                continue
            if r["remind_min"] and now < start and (r["reminded_for"] is None or r["reminded_for"] < start):
                await pool().execute("UPDATE server_events SET reminded_for = $2 WHERE id = $1", r["id"], start)
                await _alert(r, "event_reminder")
            if start <= now:
                if r["started_for"] is None or r["started_for"] < start:
                    r = await pool().fetchrow("UPDATE server_events SET started_for = $2 WHERE id = $1 RETURNING *", r["id"], start)
                    await _alert(r, "event_start")
                    await _changed(r["server_id"])
                await _count_presence(r)
        except Exception:
            log.exception("noite da turma %s", r["id"])


async def noites_loop() -> None:
    while True:
        try:
            await tick()
        except asyncio.CancelledError:
            raise
        except Exception:
            log.exception("relógio das noites")
        await asyncio.sleep(TICK)
