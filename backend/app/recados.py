"""Recado na call vazia: entrou e não tem ninguém? Deixa um áudio curto que quem entrar depois ouve.

Regras: só quem está SOZINHO naquela call grava; até 30 s e 1 MB; no máximo 3 recados seus por call e
20 por call; somem sozinhos em 7 dias. Quem não enxerga o canal não lista nem baixa o áudio
(files.file_access_allowed confere pelo canal do recado).
"""

from __future__ import annotations

import asyncio
import logging

from fastapi import APIRouter, Form, UploadFile

from .core import Auth, CurrentUser, err, fetch_user, file_url, new_id, parse_id, pool, settings, sid, user_out
from .perms import member as perms_member
from .realtime import can_access_channel, hub

log = logging.getLogger("recados")
router = APIRouter()

MAX_SECONDS = 30
PER_AUTHOR = 3
PER_CHANNEL = 20
KEEP_DAYS = 7


async def _voice_channel(user_id: int, channel_id: int) -> dict:
    ch = await can_access_channel(user_id, channel_id)
    if not ch or ch["type"] != "voice":
        raise err(404, "Canal não encontrado.")
    return ch


async def _drop_file(file_id: int) -> None:
    row = await pool().fetchrow("DELETE FROM files WHERE id = $1 RETURNING path", file_id)
    if row:
        try:
            (settings.upload_dir / row["path"]).unlink(missing_ok=True)
        except OSError:
            pass


@router.get("/channels/{channel_id}/recados")
async def list_recados(channel_id: str, me: Auth = CurrentUser) -> list[dict]:
    cid = parse_id(channel_id)
    await _voice_channel(me.id, cid)
    rows = await pool().fetch(
        f"""SELECT r.id, r.author_id, r.file_id, r.seconds, r.created_at,
                   EXISTS (SELECT 1 FROM recado_ouvidos o WHERE o.recado_id = r.id AND o.user_id = $2) AS heard
            FROM recados r WHERE r.channel_id = $1 AND r.created_at > now() - interval '{KEEP_DAYS} days'
            ORDER BY r.created_at DESC LIMIT {PER_CHANNEL}""",
        cid,
        me.id,
    )
    out = []
    for r in rows:
        author = await fetch_user(r["author_id"])
        out.append(
            {
                "id": sid(r["id"]),
                "author": user_out(author) if author else None,
                "url": file_url(r["file_id"]),
                "seconds": r["seconds"],
                "created_at": r["created_at"].isoformat(),
                "heard": r["heard"] or r["author_id"] == me.id,
                "mine": r["author_id"] == me.id,
            }
        )
    return out


@router.post("/channels/{channel_id}/recados")
async def create_recado(channel_id: str, file: UploadFile, seconds: int = Form(0), me: Auth = CurrentUser) -> dict:
    cid = parse_id(channel_id)
    await _voice_channel(me.id, cid)
    if hub.user_voice.get(me.id) != cid:
        raise err(403, "Entre na call para deixar um recado.")
    if set(hub.voice.get(cid, {})) != {me.id}:
        raise err(400, "Recado é para quando a call está vazia: tem gente aqui, fala com eles!")
    if not (1 <= seconds <= MAX_SECONDS):
        raise err(400, f"O recado precisa ter até {MAX_SECONDS} segundos.")
    mine, total = await pool().fetchrow(
        f"""SELECT count(*) FILTER (WHERE author_id = $2), count(*) FROM recados
            WHERE channel_id = $1 AND created_at > now() - interval '{KEEP_DAYS} days'""",
        cid,
        me.id,
    )
    if mine >= PER_AUTHOR:
        raise err(429, f"Você já deixou {PER_AUTHOR} recados nesta call. Apague um para gravar outro.")
    if total >= PER_CHANNEL:
        raise err(429, "Esta call já está cheia de recados.")
    from .files import save_upload  # noqa: PLC0415

    up = await save_upload(file, "recado", me.id)
    rid = new_id()
    await pool().execute(
        "INSERT INTO recados (id, channel_id, author_id, file_id, seconds) VALUES ($1, $2, $3, $4, $5)",
        rid,
        cid,
        me.id,
        parse_id(up["id"]),
        seconds,
    )
    await hub.to_channel(cid, "recados", {"channel_id": sid(cid)})
    return {"id": sid(rid)}


@router.post("/recados/{recado_id}/ouvido")
async def heard_recado(recado_id: str, me: Auth = CurrentUser) -> dict:
    rid = parse_id(recado_id)
    cid = await pool().fetchval("SELECT channel_id FROM recados WHERE id = $1", rid)
    if not cid:
        raise err(404, "Recado não encontrado.")
    await _voice_channel(me.id, cid)
    await pool().execute("INSERT INTO recado_ouvidos (recado_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING", rid, me.id)
    return {"ok": True}


@router.delete("/recados/{recado_id}")
async def delete_recado(recado_id: str, me: Auth = CurrentUser) -> dict:
    rid = parse_id(recado_id)
    row = await pool().fetchrow(
        "SELECT r.channel_id, r.author_id, r.file_id, c.server_id FROM recados r JOIN channels c ON c.id = r.channel_id WHERE r.id = $1",
        rid,
    )
    if not row:
        raise err(404, "Recado não encontrado.")
    await _voice_channel(me.id, row["channel_id"])
    if row["author_id"] != me.id:
        who = await perms_member(row["server_id"], me.id) if row["server_id"] else None
        if not (who and who.can("moderar_voz")):
            raise err(403, "Só quem gravou (ou quem modera a call) apaga o recado.")
    await pool().execute("DELETE FROM recados WHERE id = $1", rid)
    await _drop_file(row["file_id"])
    await hub.to_channel(row["channel_id"], "recados", {"channel_id": sid(row["channel_id"])})
    return {"ok": True}


async def recados_loop() -> None:
    """Recados com mais de 7 dias somem (com o áudio)."""
    while True:
        try:
            rows = await pool().fetch(
                f"DELETE FROM recados WHERE created_at < now() - interval '{KEEP_DAYS} days' RETURNING file_id"
            )
            for r in rows:
                await _drop_file(r["file_id"])
        except Exception as e:  # noqa: BLE001
            log.warning("recados: limpeza falhou (%s)", type(e).__name__)
        await asyncio.sleep(3600)
