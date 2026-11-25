"""Retrospectiva do mês e "visto na call".

- log_play: cada vídeo novo que toca no YouTube da call fica anotado (music_log). Serve para o
  Adivinhe a música, para a lista "Visto na call" e para a retrospectiva.
- Retrospectiva: quem mais ficou em call, mais transmitiu, mais falou no chat, mais ganhou nos
  minigames, as músicas que mais tocaram e o emoji do mês.

Privacidade: só membros do servidor veem. Mensagens e reações contam só nos canais abertos a todos
(canal com cargo na visão fica de fora), e as músicas só das calls que a pessoa consegue ver.
"""

from __future__ import annotations

import re
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter

from .core import Auth, CurrentUser, err, fetch_user, parse_id, pool, sid, user_out
from .perms import member as perms_member
from .realtime import can_access_channel

router = APIRouter()
BRT = timezone(timedelta(hours=-3))


async def log_play(server_id: int | None, channel_id: int, video_id: str, title: str, author: str, by: int, from_radio: bool) -> None:
    if not server_id:
        return
    await pool().execute(
        """INSERT INTO music_log (server_id, channel_id, video_id, title, author, played_by, from_radio)
           VALUES ($1, $2, $3, $4, $5, $6, $7)""",
        server_id, channel_id, video_id, (title or "")[:200], (author or "")[:100], by, from_radio,
    )


async def _member(server_id: int, user_id: int) -> None:
    if not await perms_member(server_id, user_id):
        raise err(404, "Servidor não encontrado.")


async def _visible_voice(server_id: int, user_id: int) -> list[int]:
    rows = await pool().fetch("SELECT id FROM channels WHERE server_id = $1 AND type = 'voice'", server_id)
    return [r["id"] for r in rows if await can_access_channel(user_id, r["id"])]


def month_range(month: str | None) -> tuple[str, datetime, datetime]:
    now = datetime.now(BRT)
    if not month:
        month = f"{now.year:04d}-{now.month:02d}"
    if not re.fullmatch(r"20\d\d-(0[1-9]|1[0-2])", month):
        raise err(400, "Mês inválido (use AAAA-MM).")
    y, m = int(month[:4]), int(month[5:])
    start = datetime(y, m, 1, tzinfo=BRT)
    end = datetime(y + (m == 12), 1 if m == 12 else m + 1, 1, tzinfo=BRT)
    return month, start, end


async def _people(ids: list[int]) -> dict[int, dict]:
    out = {}
    for uid in ids:
        if uid and uid not in out:
            row = await fetch_user(uid)
            if row:
                out[uid] = user_out(row)
    return out


@router.get("/servers/{server_id}/visto-na-call")
async def seen_in_call(server_id: str, me: Auth = CurrentUser) -> list[dict]:
    srv = parse_id(server_id)
    await _member(srv, me.id)
    channels = await _visible_voice(srv, me.id)
    if not channels:
        return []
    rows = await pool().fetch(
        """SELECT video_id, max(title) AS title, max(author) AS author, count(*) AS times, max(played_at) AS last_at,
                  (array_agg(played_by ORDER BY played_at DESC) FILTER (WHERE NOT from_radio))[1:3] AS by
           FROM music_log WHERE server_id = $1 AND channel_id = ANY($2::bigint[]) AND played_at > now() - interval '60 days'
           GROUP BY video_id ORDER BY max(played_at) DESC LIMIT 60""",
        srv,
        channels,
    )
    people = await _people([u for r in rows for u in (r["by"] or []) if u])
    return [
        {
            "video_id": r["video_id"],
            "title": r["title"],
            "author": r["author"],
            "times": r["times"],
            "last_at": r["last_at"].isoformat(),
            "by": [people[u] for u in dict.fromkeys(r["by"] or []) if u in people],
        }
        for r in rows
    ]


@router.get("/servers/{server_id}/retrospectiva")
async def retrospective(server_id: str, mes: str | None = None, me: Auth = CurrentUser) -> dict:
    srv = parse_id(server_id)
    await _member(srv, me.id)
    month, start, end = month_range(mes)
    open_channels = [
        r["id"]
        for r in await pool().fetch(
            "SELECT id FROM channels WHERE server_id = $1 AND type <> 'voice' AND cardinality(view_roles) = 0", srv
        )
    ]
    voice = await _visible_voice(srv, me.id)

    talkers = await pool().fetch(
        """SELECT author_id, count(*) AS n FROM messages
           WHERE channel_id = ANY($1::bigint[]) AND created_at >= $2 AND created_at < $3 AND kind = 'default' AND author_id IS NOT NULL
           GROUP BY author_id ORDER BY n DESC LIMIT 5""",
        open_channels, start, end,
    )
    total_msgs = await pool().fetchval(
        """SELECT count(*) FROM messages WHERE channel_id = ANY($1::bigint[]) AND created_at >= $2 AND created_at < $3 AND kind = 'default'""",
        open_channels, start, end,
    )
    emojis = await pool().fetch(
        """SELECT r.emoji, count(*) AS n FROM reactions r JOIN messages m ON m.id = r.message_id
           WHERE m.channel_id = ANY($1::bigint[]) AND m.created_at >= $2 AND m.created_at < $3
           GROUP BY r.emoji ORDER BY n DESC LIMIT 5""",
        open_channels, start, end,
    )
    star = await pool().fetchrow(
        """SELECT m.id, m.channel_id, m.author_id, m.content, count(r.*) AS n FROM messages m JOIN reactions r ON r.message_id = m.id
           WHERE m.channel_id = ANY($1::bigint[]) AND m.created_at >= $2 AND m.created_at < $3 AND m.kind = 'default'
             AND m.visible_to IS NULL AND m.expires_at IS NULL
           GROUP BY m.id ORDER BY n DESC, m.id LIMIT 1""",
        open_channels, start, end,
    )
    stats = await pool().fetch(
        "SELECT user_id, call_seconds, share_seconds, watch_seconds, games_won FROM stats_monthly WHERE server_id = $1 AND month = $2",
        srv, month,
    )
    songs = await pool().fetch(
        """SELECT video_id, max(title) AS title, max(author) AS author, count(*) AS n FROM music_log
           WHERE server_id = $1 AND channel_id = ANY($2::bigint[]) AND played_at >= $3 AND played_at < $4
           GROUP BY video_id ORDER BY n DESC LIMIT 5""",
        srv, voice, start, end,
    )

    def top(key: str) -> list[tuple[int, int]]:
        return [(r["user_id"], int(r[key])) for r in sorted(stats, key=lambda r: -r[key]) if r[key] > 0][:5]

    ids = [r["author_id"] for r in talkers] + [u for k in ("call_seconds", "share_seconds", "watch_seconds", "games_won") for u, _ in top(k)]
    if star:
        ids.append(star["author_id"])
    people = await _people(ids)
    mine = next((r for r in stats if r["user_id"] == me.id), None)
    my_msgs = await pool().fetchval(
        """SELECT count(*) FROM messages WHERE channel_id = ANY($1::bigint[]) AND created_at >= $2 AND created_at < $3 AND author_id = $4 AND kind = 'default'""",
        open_channels, start, end, me.id,
    )

    def board(key: str) -> list[dict]:
        return [{"user": people[u], "value": v} for u, v in top(key) if u in people]

    return {
        "month": month,
        "messages": {"total": total_msgs, "top": [{"user": people[r["author_id"]], "value": r["n"]} for r in talkers if r["author_id"] in people]},
        "emojis": [{"emoji": r["emoji"], "value": r["n"]} for r in emojis],
        "star": (
            {"id": sid(star["id"]), "channel_id": sid(star["channel_id"]), "user": people.get(star["author_id"]), "content": star["content"][:280], "value": star["n"]}
            if star
            else None
        ),
        "call": board("call_seconds"),
        "share": board("share_seconds"),
        "watch": board("watch_seconds"),
        "games": board("games_won"),
        "call_total": sum(r["call_seconds"] for r in stats),
        "songs": [{"video_id": r["video_id"], "title": r["title"], "author": r["author"], "value": r["n"]} for r in songs],
        "me": {
            "messages": my_msgs,
            "call_seconds": mine["call_seconds"] if mine else 0,
            "share_seconds": mine["share_seconds"] if mine else 0,
            "watch_seconds": mine["watch_seconds"] if mine else 0,
            "games_won": mine["games_won"] if mine else 0,
        },
    }
