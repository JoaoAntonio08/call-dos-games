"""Recado na call vazia: entrou e não tem ninguém? Deixa um áudio curto que quem entrar depois ouve.

Regras: só quem está SOZINHO naquela call grava; até 30 s e 1 MB; no máximo 3 recados seus por call e
20 por call; somem sozinhos em 7 dias. Quem não enxerga o canal não lista nem baixa o áudio
(files.file_access_allowed confere pelo canal do recado).
"""

from __future__ import annotations

import asyncio
import logging
import math
import time
from pathlib import Path

from fastapi import APIRouter, Form, UploadFile

from .audio_len import audio_seconds, decoded_seconds
from .core import Auth, CurrentUser, err, fetch_user, file_url, new_id, parse_id, pool, settings, sid, user_out
from .perms import member as perms_member
from .realtime import can_access_channel, hub

log = logging.getLogger("recados")
router = APIRouter()

MAX_SECONDS = 30
PER_AUTHOR = 3
PER_CHANNEL = 20
KEEP_DAYS = 7
TOLERANCE = 1.0  # o gravador para um pouquinho depois dos 30 s
DECODE_SLOTS = asyncio.Semaphore(2)  # decodificar usa CPU: poucos ao mesmo tempo, fora do laço principal
RECADO_TYPES = {".webm", ".m4a", ".ogg", ".opus"}  # o que o MediaRecorder grava


async def _voice_channel(user_id: int, channel_id: int) -> dict:
    ch = await can_access_channel(user_id, channel_id)
    if not ch or ch["type"] != "voice":
        raise err(404, "Canal não encontrado.")
    return ch


def _unlink(rel: str | None) -> None:
    if not rel:
        return
    try:
        (settings.upload_dir / rel).unlink(missing_ok=True)
    except OSError:
        pass  # a faxina de hora em hora tenta de novo


async def _drop_file(file_id: int) -> None:
    _unlink(await pool().fetchval("DELETE FROM files WHERE id = $1 RETURNING path", file_id))


async def _counts(db, cid: int, uid: int) -> tuple[int, int]:
    row = await db.fetchrow(
        f"""SELECT count(*) FILTER (WHERE author_id = $2) AS mine, count(*) AS total FROM recados
            WHERE channel_id = $1 AND created_at > now() - interval '{KEEP_DAYS} days'""",
        cid,
        uid,
    )
    return int(row["mine"]), int(row["total"])


def _check_limits(mine: int, total: int) -> None:
    if mine >= PER_AUTHOR:
        raise err(429, f"Você já deixou {PER_AUTHOR} recados nesta call. Apague um para gravar outro.")
    if total >= PER_CHANNEL:
        raise err(429, "Esta call já está cheia de recados.")


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
    if Path(file.filename or "").suffix.lower() not in RECADO_TYPES:
        raise err(400, "O recado precisa ser gravado pelo app (WebM, OGG ou M4A).")
    _check_limits(*await _counts(pool(), cid, me.id))  # recusa cedo, antes de gravar o arquivo
    from .files import LIMITS, save_upload  # noqa: PLC0415

    # a duração vem do próprio áudio, não do que o app diz
    data = await file.read(LIMITS["recado"] + 1)
    await file.seek(0)
    real = audio_seconds(data[: LIMITS["recado"]]) if len(data) <= LIMITS["recado"] else None
    if real is None:
        raise err(400, "Não deu para ler esse áudio. Grave de novo pelo botão do recado.")
    if real > MAX_SECONDS + TOLERANCE:
        raise err(400, f"O recado precisa ter até {MAX_SECONDS} segundos.")
    # o cabeçalho passou na peneira; agora vale o que o áudio decodificado diz
    async with DECODE_SLOTS:
        real = await asyncio.to_thread(decoded_seconds, data, MAX_SECONDS + TOLERANCE + 5)
    if real is None:
        raise err(400, "Não deu para ler esse áudio. Grave de novo pelo botão do recado.")
    if real > MAX_SECONDS + TOLERANCE:
        raise err(400, f"O recado precisa ter até {MAX_SECONDS} segundos.")
    if real < 0.5:
        raise err(400, "Recado curtinho demais.")
    seconds = max(1, min(MAX_SECONDS, math.ceil(real)))

    up = await save_upload(file, "recado", me.id)
    file_id = parse_id(up["id"])
    rid = new_id()
    try:
        async with pool().acquire() as con, con.transaction():
            # dois envios ao mesmo tempo esperam um pelo outro e contam de novo: o limite não estoura
            await con.execute("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", f"recados:{cid}")
            _check_limits(*await _counts(con, cid, me.id))
            await con.execute(
                "INSERT INTO recados (id, channel_id, author_id, file_id, seconds) VALUES ($1, $2, $3, $4, $5)",
                rid,
                cid,
                me.id,
                file_id,
                seconds,
            )
    except BaseException:
        await _drop_file(file_id)  # não deixa áudio sem recado para trás
        raise
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
    async with pool().acquire() as con, con.transaction():
        await con.execute("DELETE FROM recados WHERE id = $1", rid)
        path = await con.fetchval("DELETE FROM files WHERE id = $1 RETURNING path", row["file_id"])
    _unlink(path)
    await hub.to_channel(row["channel_id"], "recados", {"channel_id": sid(row["channel_id"])})
    return {"ok": True}


async def cleanup_recados() -> int:
    """Recados velhos somem com o áudio; e a faxina pega o que ficou pela metade (registro sem
    recado ou arquivo no disco sem registro) por causa de uma falha no meio do caminho."""
    removed = 0
    async with pool().acquire() as con, con.transaction():
        old = await con.fetch(f"DELETE FROM recados WHERE created_at < now() - interval '{KEEP_DAYS} days' RETURNING file_id")
        paths = await con.fetch(
            """DELETE FROM files f WHERE f.kind = 'recado'
                 AND (f.id = ANY($1::bigint[])
                      OR (f.created_at < now() - interval '1 hour'
                          AND NOT EXISTS (SELECT 1 FROM recados r WHERE r.file_id = f.id)))
               RETURNING f.path""",
            [r["file_id"] for r in old],
        )
    for r in paths:
        _unlink(r["path"])
        removed += 1
    folder = settings.upload_dir / "recado"
    if folder.is_dir():
        known = {r["path"] for r in await pool().fetch("SELECT path FROM files WHERE kind = 'recado'")}
        cutoff = time.time() - 3600
        for f in folder.iterdir():
            rel = f"recado/{f.name}"
            try:
                if f.is_file() and rel not in known and f.stat().st_mtime < cutoff:
                    f.unlink()
                    removed += 1
            except OSError:
                pass
    return removed


async def recados_loop() -> None:
    while True:
        try:
            await cleanup_recados()
        except Exception as e:  # noqa: BLE001
            log.warning("recados: limpeza falhou (%s)", type(e).__name__)
        await asyncio.sleep(3600)
