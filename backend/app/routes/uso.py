"""Uso de transmissão (tela e câmera): quanto cada pessoa gasta e limites.

Cada app mede quantos bytes mandou de tela/câmera (estatística do WebRTC) e avisa a cada 30 s.
O que sai do servidor de voz é isso vezes quem está assistindo (as outras pessoas da call).

Quem vê e limita: dono e admins do servidor, cargos com a permissão "uso" e os admins da plataforma
(PLATFORM_ADMIN_IDS no .env, por id imutável de usuário). Uma restrição tira a tela e a câmera da pessoa
(o microfone continua). Pode ser manual (por um tempo ou até liberar) ou automática, quando a pessoa
passa do limite de GB do servidor no dia ou no mês.
"""

from __future__ import annotations

import asyncio
import json
from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import APIRouter
from pydantic import BaseModel

from ..core import Auth, CurrentUser, err, fetch_user, parse_id, pool, settings, sid, user_out
from ..perms import RANK, member
from ..realtime import hub

router = APIRouter()

BRT = timezone(timedelta(hours=-3))
GB = 1_000_000_000
# um app não manda mais que isso em 30 s (≈ 270 Mbps): número maior é erro ou trapaça
MAX_REPORT_BYTES = 1_000_000_000
PLATFORM = 0  # "escopo" das restrições que valem em todos os servidores


def is_platform_admin(user_id: int) -> bool:
    return user_id in settings.platform_admin_ids


async def platform_admin(user_id: int) -> bool:
    return is_platform_admin(user_id)


async def require_usage(server_id: int, user_id: int) -> str:
    """Pode ver e limitar o uso deste servidor? Devolve o cargo da pessoa ('platform' para admin da plataforma)."""
    m = await member(server_id, user_id)
    if m and m.can("uso"):
        return m.role
    if await platform_admin(user_id):
        if not await pool().fetchval("SELECT 1 FROM servers WHERE id = $1", server_id):
            raise err(404, "Servidor não encontrado.")
        return "platform"
    if not m:
        raise err(404, "Servidor não encontrado.")
    raise err(403, "Seu cargo não pode ver o uso do servidor.")


# ------------------------------------------------------------------ restrições
async def active_block(server_id: int | None, user_id: int) -> dict | None:
    """A restrição que vale agora para essa pessoa neste servidor (a da plataforma vale em todos)."""
    scopes = [PLATFORM] + ([server_id] if server_id is not None else [])
    row = await pool().fetchrow(
        """SELECT scope, until, reason FROM share_blocks
           WHERE user_id = $1 AND scope = ANY($2::bigint[]) AND (until IS NULL OR until > now())
           ORDER BY scope ASC, until DESC NULLS FIRST LIMIT 1""",
        user_id, scopes,
    )
    if not row:
        return None
    return {"platform": row["scope"] == PLATFORM, "until": row["until"].isoformat() if row["until"] else None, "reason": row["reason"]}


async def reapply(user_id: int, server_id: int | None) -> None:
    """Aplica de novo as permissões inclusive em conexões não anunciadas no gateway."""
    from .voz import refresh_user_voice

    await refresh_user_voice(user_id, server_id)


async def set_block(scope: int, user_id: int, until: datetime | None, reason: str, by: int | None) -> None:
    await pool().execute(
        """INSERT INTO share_blocks (scope, user_id, until, reason, by_id) VALUES ($1,$2,$3,$4,$5)
           ON CONFLICT (scope, user_id) DO UPDATE SET until = EXCLUDED.until, reason = EXCLUDED.reason, by_id = EXCLUDED.by_id, created_at = now()""",
        scope, user_id, until, reason, by,
    )
    name = None
    if scope != PLATFORM:
        name = await pool().fetchval("SELECT name FROM servers WHERE id = $1", scope)
    await hub.send(
        [user_id],
        "share_block",
        {"server_id": sid(scope) if scope != PLATFORM else None, "server_name": name, "until": until.isoformat() if until else None, "reason": reason},
    )
    await reapply(user_id, None if scope == PLATFORM else scope)


async def clear_block(scope: int, user_id: int) -> None:
    gone = await pool().execute("DELETE FROM share_blocks WHERE scope = $1 AND user_id = $2", scope, user_id)
    await reapply(user_id, None if scope == PLATFORM else scope)
    # avisa a pessoa (se ela não continua restrita por outro motivo, como a plataforma)
    if gone != "DELETE 0" and not await active_block(None if scope == PLATFORM else scope, user_id):
        await hub.send([user_id], "share_unblock", {"server_id": sid(scope) if scope else None})


def period_end(period: str, now: datetime | None = None) -> datetime:
    now = (now or datetime.now(timezone.utc)).astimezone(BRT)
    if period == "mes":
        first = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        nxt = (first + timedelta(days=32)).replace(day=1)
    else:
        nxt = now.replace(hour=0, minute=0, second=0, microsecond=0) + timedelta(days=1)
    return nxt.astimezone(timezone.utc)


def period_start(period: str) -> datetime:
    now = datetime.now(BRT)
    start = now.replace(day=1) if period == "mes" else now
    return start.replace(hour=0, minute=0, second=0, microsecond=0)


def limit_of(raw: Any) -> dict:
    d = json.loads(raw) if isinstance(raw, str) else dict(raw or {})
    return {"enabled": bool(d.get("enabled")), "gb": float(d.get("gb") or 10), "period": d.get("period") if d.get("period") in ("dia", "mes") else "dia"}


# ------------------------------------------------------------------ medição (o app manda)
class UsageIn(BaseModel):
    channel_id: str
    screen_bytes: int = 0
    camera_bytes: int = 0
    seconds: int = 0


@router.post("/voice/usage")
async def report_usage(body: UsageIn, me: Auth = CurrentUser) -> dict:
    cid = parse_id(body.channel_id)
    if hub.user_voice.get(me.id) != cid:
        return {"ok": False}  # só conta quem está mesmo na call
    up = max(0, min(MAX_REPORT_BYTES, body.screen_bytes)) + max(0, min(MAX_REPORT_BYTES, body.camera_bytes))
    secs = max(0, min(120, body.seconds))
    if not up and not secs:
        return {"ok": True}
    viewers = max(0, len(hub.voice.get(cid, {})) - 1)
    out = up * viewers
    srv = await pool().fetchval("SELECT server_id FROM channels WHERE id = $1", cid)
    scope = srv if srv is not None else PLATFORM
    day = datetime.now(BRT).date()
    await pool().execute(
        """INSERT INTO share_usage (scope, user_id, day, seconds, bytes_up, bytes_out) VALUES ($1,$2,$3,$4,$5,$6)
           ON CONFLICT (scope, user_id, day) DO UPDATE SET seconds = share_usage.seconds + EXCLUDED.seconds,
             bytes_up = share_usage.bytes_up + EXCLUDED.bytes_up, bytes_out = share_usage.bytes_out + EXCLUDED.bytes_out""",
        scope, me.id, day, secs, up, out,
    )
    if srv is not None:
        await auto_limit(srv, me.id)
    return {"ok": True}


async def auto_limit(server_id: int, user_id: int) -> None:
    raw = await pool().fetchval("SELECT share_limit FROM servers WHERE id = $1", server_id)
    lim = limit_of(raw)
    if not lim["enabled"] or lim["gb"] <= 0:
        return
    role = await pool().fetchval("SELECT role FROM members WHERE server_id = $1 AND user_id = $2", server_id, user_id)
    if RANK.get(role or "member", 0) >= 1:
        return  # dono e admins não entram no limite automático
    if await active_block(server_id, user_id):
        return
    used = await pool().fetchval(
        "SELECT COALESCE(SUM(bytes_out), 0) FROM share_usage WHERE scope = $1 AND user_id = $2 AND day >= $3",
        server_id, user_id, period_start(lim["period"]).date(),
    )
    if used >= lim["gb"] * GB:
        await set_block(server_id, user_id, period_end(lim["period"]), "auto", None)


# ------------------------------------------------------------------ painel do servidor
def _since(days: int) -> Any:
    days = days if days in (1, 7, 30) else 1
    return (datetime.now(BRT) - timedelta(days=days - 1)).date()


async def _people(scope_sql: str, args: list, since: Any, limit: int = 100) -> list[dict]:
    rows = await pool().fetch(
        f"""SELECT u.id, SUM(su.seconds) AS seconds, SUM(su.bytes_up) AS up, SUM(su.bytes_out) AS out
            FROM share_usage su JOIN users u ON u.id = su.user_id
            WHERE {scope_sql} AND su.day >= ${len(args) + 1}
            GROUP BY u.id ORDER BY SUM(su.bytes_out) DESC, SUM(su.bytes_up) DESC LIMIT {int(limit)}""",
        *args, since,
    )
    out = []
    for r in rows:
        u = await fetch_user(r["id"])
        out.append({"user": user_out(u) if u else None, "seconds": int(r["seconds"]), "bytes_up": int(r["up"]), "bytes_out": int(r["out"])})
    return out


@router.get("/servers/{server_id}/usage")
async def server_usage(server_id: str, days: int = 1, me: Auth = CurrentUser) -> dict:
    s = parse_id(server_id)
    await require_usage(s, me.id)
    since = _since(days)
    people = await _people("su.scope = $1", [s], since)
    # quem está restrito aparece mesmo sem ter gastado no período
    blocked = await pool().fetch(
        "SELECT user_id FROM share_blocks WHERE scope IN ($1, 0) AND (until IS NULL OR until > now())", s
    )
    listed = {p["user"]["id"] for p in people if p["user"]}
    members = {r["user_id"] for r in await pool().fetch("SELECT user_id FROM members WHERE server_id = $1", s)}
    for r in blocked:
        if sid(r["user_id"]) not in listed and r["user_id"] in members:
            u = await fetch_user(r["user_id"])
            people.append({"user": user_out(u) if u else None, "seconds": 0, "bytes_up": 0, "bytes_out": 0})
    roles = {r["user_id"]: r["role"] for r in await pool().fetch("SELECT user_id, role FROM members WHERE server_id = $1", s)}
    for p in people:
        uid = int(p["user"]["id"]) if p["user"] else 0
        p["role"] = roles.get(uid)
        p["block"] = await active_block(s, uid)
    raw = await pool().fetchval("SELECT share_limit FROM servers WHERE id = $1", s)
    return {
        "days": days if days in (1, 7, 30) else 1,
        "total": {k: sum(p[k] for p in people) for k in ("seconds", "bytes_up", "bytes_out")},
        "people": people,
        "limit": limit_of(raw),
        "live": [{"user_id": sid(uid), "channel_id": sid(cid)} for cid, users in hub.voice.items() for uid, st in users.items()
                 if (st.get("stream") or st.get("video")) and uid in members],
    }


class LimitIn(BaseModel):
    enabled: bool
    gb: float = 10
    period: str = "dia"


@router.put("/servers/{server_id}/usage/limit")
async def set_limit(server_id: str, body: LimitIn, me: Auth = CurrentUser) -> dict:
    s = parse_id(server_id)
    await require_usage(s, me.id)
    if body.period not in ("dia", "mes"):
        raise err(400, "Período inválido.")
    if not 0.1 <= body.gb <= 10000:
        raise err(400, "O limite precisa ficar entre 0,1 e 10000 GB.")
    lim = {"enabled": body.enabled, "gb": round(body.gb, 2), "period": body.period}
    await pool().execute("UPDATE servers SET share_limit = $1::jsonb WHERE id = $2", json.dumps(lim), s)
    return lim


class BlockIn(BaseModel):
    hours: float | None = None  # None = até alguém liberar


def _until(hours: float | None) -> datetime | None:
    if hours is None:
        return None
    if not 0 < hours <= 24 * 365:
        raise err(400, "Tempo inválido.")
    return datetime.now(timezone.utc) + timedelta(hours=hours)


async def _check_target(server_id: int, my_role: str, target: int) -> None:
    theirs = await pool().fetchval("SELECT role FROM members WHERE server_id = $1 AND user_id = $2", server_id, target)
    if not theirs:
        raise err(404, "Essa pessoa não está no servidor.")
    if my_role == "platform":
        return
    if theirs == "owner" or (RANK.get(theirs, 0) >= 1 and my_role != "owner"):
        raise err(403, "Você não pode restringir essa pessoa.")


@router.put("/servers/{server_id}/usage/block/{user_id}")
async def block_user(server_id: str, user_id: str, body: BlockIn, me: Auth = CurrentUser) -> dict:
    s, target = parse_id(server_id), parse_id(user_id)
    role = await require_usage(s, me.id)
    if target == me.id:
        raise err(400, "Escolha outra pessoa.")
    await _check_target(s, role, target)
    await set_block(s, target, _until(body.hours), "manual", me.id)
    return {"ok": True, "block": await active_block(s, target)}


@router.delete("/servers/{server_id}/usage/block/{user_id}")
async def unblock_user(server_id: str, user_id: str, me: Auth = CurrentUser) -> dict:
    s, target = parse_id(server_id), parse_id(user_id)
    role = await require_usage(s, me.id)
    await _check_target(s, role, target)
    await clear_block(s, target)
    return {"ok": True, "block": await active_block(s, target)}


# ------------------------------------------------------------------ painel da plataforma (admin geral)
async def require_platform(user_id: int) -> None:
    if not await platform_admin(user_id):
        raise err(403, "Só o admin da plataforma vê isso.")


@router.get("/platform/usage")
async def platform_usage(days: int = 1, me: Auth = CurrentUser) -> dict:
    await require_platform(me.id)
    since = _since(days)
    servers = await pool().fetch(
        """SELECT su.scope, s.name, SUM(su.seconds) AS seconds, SUM(su.bytes_up) AS up, SUM(su.bytes_out) AS out
           FROM share_usage su LEFT JOIN servers s ON s.id = su.scope
           WHERE su.day >= $1 GROUP BY su.scope, s.name ORDER BY SUM(su.bytes_out) DESC""",
        since,
    )
    people = await _people("TRUE", [], since, limit=100)
    for p in people:
        uid = int(p["user"]["id"]) if p["user"] else 0
        row = await pool().fetchrow(
            "SELECT until, reason FROM share_blocks WHERE scope = 0 AND user_id = $1 AND (until IS NULL OR until > now())", uid
        )
        p["block"] = {"platform": True, "until": row["until"].isoformat() if row["until"] else None, "reason": row["reason"]} if row else None
    return {
        "days": days if days in (1, 7, 30) else 1,
        "servers": [
            {"id": sid(r["scope"]) if r["scope"] else None, "name": r["name"] or "Conversas diretas", "seconds": int(r["seconds"]), "bytes_up": int(r["up"]), "bytes_out": int(r["out"])}
            for r in servers
        ],
        "people": people,
        "total": {"seconds": sum(int(r["seconds"]) for r in servers), "bytes_up": sum(int(r["up"]) for r in servers), "bytes_out": sum(int(r["out"]) for r in servers)},
    }


@router.put("/platform/usage/block/{user_id}")
async def platform_block(user_id: str, body: BlockIn, me: Auth = CurrentUser) -> dict:
    await require_platform(me.id)
    target = parse_id(user_id)
    if target == me.id:
        raise err(400, "Escolha outra pessoa.")
    await set_block(PLATFORM, target, _until(body.hours), "manual", me.id)
    return {"ok": True}


@router.delete("/platform/usage/block/{user_id}")
async def platform_unblock(user_id: str, me: Auth = CurrentUser) -> dict:
    await require_platform(me.id)
    await clear_block(PLATFORM, parse_id(user_id))
    return {"ok": True}


# ------------------------------------------------------------------ restrição que venceu: devolve a tela/câmera
async def expire_loop() -> None:
    while True:
        try:
            rows = await pool().fetch("DELETE FROM share_blocks WHERE until IS NOT NULL AND until <= now() RETURNING scope, user_id")
            for r in rows:
                await reapply(r["user_id"], None if r["scope"] == PLATFORM else r["scope"])
                await hub.send([r["user_id"]], "share_unblock", {"server_id": sid(r["scope"]) if r["scope"] else None})
        except asyncio.CancelledError:
            raise
        except Exception:
            pass
        await asyncio.sleep(30)
