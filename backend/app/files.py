"""Uploads: fotos e banners (estáticos ou animados), ícones, emojis, sons e anexos."""

from __future__ import annotations

import asyncio
import io
import json
import mimetypes
import shutil
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Cookie, Depends, Header, UploadFile
from fastapi.responses import FileResponse
from PIL import Image, ImageSequence

from .core import CurrentUser, Auth, err, file_url, new_id, parse_id, pool, settings, sid, user_from_token
from .realtime import can_access_channel

router = APIRouter()

MB = 1024 * 1024
LIMITS = {
    "avatar": 10 * MB,
    "banner": 15 * MB,
    "icon": 10 * MB,
    "emoji": 1 * MB,
    "sticker": 3 * MB,
    "sound": 2 * MB,
    "attachment": 25 * MB,
}
IMAGE_KINDS = {"avatar", "banner", "icon", "emoji", "sticker"}
IMAGE_FORMATS = {"PNG": "image/png", "JPEG": "image/jpeg", "GIF": "image/gif", "WEBP": "image/webp"}
AUDIO_TYPES = {
    ".mp3": "audio/mpeg",
    ".ogg": "audio/ogg",
    ".oga": "audio/ogg",
    ".opus": "audio/ogg",
    ".wav": "audio/wav",
    ".webm": "audio/webm",
    ".m4a": "audio/mp4",
    ".aac": "audio/aac",
}
# tipos que o navegador pode mostrar direto; o resto baixa como arquivo
INLINE_TYPES = {
    "image/png", "image/jpeg", "image/gif", "image/webp",
    "video/mp4", "video/webm", "audio/mpeg", "audio/ogg", "audio/wav", "audio/webm", "audio/mp4", "audio/aac",
    "text/plain",
}
PUBLIC_KINDS = {"avatar", "banner", "icon"}
_upload_lock = asyncio.Lock()
UPLOAD_ADVISORY_LOCK = 0x43444701


async def enforce_upload_budget(owner_id: int, incoming: int, database: Any | None = None) -> None:
    database = database or pool()
    usage = await database.fetchrow(
        """SELECT COALESCE(SUM(stored_size), 0) AS bytes,
                  COUNT(*) FILTER (WHERE created_at > now() - interval '1 hour') AS recent
           FROM files WHERE owner_id = $1""",
        owner_id,
    )
    user_limit = settings.upload_user_quota_mb * MB
    if int(usage["bytes"]) + incoming > user_limit:
        raise err(413, f"Sua cota de arquivos chegou ao limite de {settings.upload_user_quota_mb} MB.")
    if int(usage["recent"]) >= settings.upload_rate_per_hour:
        raise err(429, f"Limite de {settings.upload_rate_per_hour} uploads por hora. Tente mais tarde.")
    total = int(await database.fetchval("SELECT COALESCE(SUM(stored_size), 0) FROM files") or 0)
    if total + incoming > settings.upload_total_quota_mb * MB:
        raise err(507, "O armazenamento de arquivos do servidor chegou ao limite.")
    free = shutil.disk_usage(settings.upload_dir).free
    if free - incoming < settings.upload_min_free_mb * MB:
        raise err(507, "O servidor está preservando a reserva mínima de espaço em disco.")


async def file_user(
    authorization: str = Header(default=""),
    cdg_session: str | None = Cookie(default=None),
) -> Auth | None:
    """Arquivos GET aceitam bearer ou o cookie HttpOnly emitido no login."""
    token = authorization[7:].strip() if authorization.lower().startswith("bearer ") else cdg_session
    found = await user_from_token(token) if token else None
    return Auth(*found) if found else None


FileUser = Depends(file_user)


async def file_access_allowed(row: Any, me: Auth | None) -> bool:
    if row["kind"] in PUBLIC_KINDS:
        return True
    if not me:
        return False
    if row["owner_id"] == me.id:
        return True

    file_id = row["id"]
    if row["kind"] == "sticker" and await pool().fetchval(
        "SELECT 1 FROM stickers WHERE file_id = $1 AND user_id = $2", file_id, me.id
    ):
        return True
    if row["kind"] == "sound" and await pool().fetchval(
        """SELECT 1
           WHERE EXISTS (
               SELECT 1 FROM sounds s JOIN members m ON m.server_id = s.server_id
               WHERE s.file_id = $1 AND m.user_id = $2
           ) OR EXISTS (
               SELECT 1 FROM users u
               WHERE u.join_sound_id = $1 AND (
                   EXISTS (SELECT 1 FROM members owner_m JOIN members viewer_m USING (server_id)
                           WHERE owner_m.user_id = u.id AND viewer_m.user_id = $2)
                   OR EXISTS (SELECT 1 FROM dm_participants owner_d JOIN dm_participants viewer_d USING (channel_id)
                              WHERE owner_d.user_id = u.id AND viewer_d.user_id = $2)
                   OR EXISTS (SELECT 1 FROM friendships f
                              WHERE f.status = 'accepted' AND ((f.requester_id = u.id AND f.addressee_id = $2)
                                   OR (f.addressee_id = u.id AND f.requester_id = $2)))
               )
           )""",
        file_id,
        me.id,
    ):
        return True
    if row["kind"] == "emoji" and await pool().fetchval(
        """SELECT 1 FROM emojis e JOIN members m ON m.server_id = e.server_id
           WHERE e.file_id = $1 AND m.user_id = $2""",
        file_id,
        me.id,
    ):
        return True

    # Anexos e figurinhas enviados só podem ser lidos por quem ainda vê a mensagem.
    candidates = await pool().fetch(
        "SELECT channel_id, visible_to FROM messages WHERE attachments @> $1::jsonb",
        json.dumps([{"id": sid(file_id)}]),
    )
    for message in candidates:
        if message["visible_to"] is not None and message["visible_to"] != me.id:
            continue
        if await can_access_channel(me.id, message["channel_id"]):
            return True
    return False


async def read_limited(upload: UploadFile, limit: int) -> bytes:
    buf = bytearray()
    while chunk := await upload.read(256 * 1024):
        buf += chunk
        if len(buf) > limit:
            raise err(413, f"Arquivo grande demais (máximo {limit // MB} MB).")
    if not buf:
        raise err(400, "Arquivo vazio.")
    return bytes(buf)


def _still_frame(im: Image.Image) -> bytes:
    frame = next(iter(ImageSequence.Iterator(im))).convert("RGBA")
    out = io.BytesIO()
    frame.save(out, "PNG", optimize=True)
    return out.getvalue()


CLIP_LIMIT = 80 * MB
# clipe sem tela nenhuma sai só com o áudio da call
CLIP_TYPES = {".mp4": "video/mp4", ".webm": "video/webm", ".m4a": "audio/mp4", ".weba": "audio/webm"}


async def save_upload(upload: UploadFile, kind: str, owner_id: int, *, clip: bool = False) -> dict[str, Any]:
    # O UploadFile já é spooled pelo framework. Serializar a leitura/decodificação
    # impede vários clipes grandes de ocuparem RAM ao mesmo tempo e mantém a cota
    # consistente com o único worker exigido pelo serviço.
    async with _upload_lock:
        await enforce_upload_budget(owner_id, 0)
        return await _save_upload_unlocked(upload, kind, owner_id, clip=clip)


async def _save_upload_unlocked(upload: UploadFile, kind: str, owner_id: int, *, clip: bool = False) -> dict[str, Any]:
    if kind not in LIMITS:
        raise err(400, "Tipo de arquivo desconhecido.")
    if clip and Path(upload.filename or "").suffix.lower() not in CLIP_TYPES:
        raise err(400, "Clipe precisa ser MP4, WebM ou áudio (M4A/WebA).")
    data = await read_limited(upload, CLIP_LIMIT if clip else LIMITS[kind])
    file_id = new_id()
    folder = settings.upload_dir / kind
    folder.mkdir(parents=True, exist_ok=True)
    original = Path(upload.filename or "arquivo").name[:120]
    width = height = None
    animated = False
    still_rel: str | None = None
    still_data: bytes | None = None

    if kind in IMAGE_KINDS:
        try:
            im = Image.open(io.BytesIO(data))
            im.verify()
            im = Image.open(io.BytesIO(data))
        except Exception:
            raise err(400, "Isso não parece uma imagem (use PNG, JPG, GIF ou WebP).")
        if im.format not in IMAGE_FORMATS:
            raise err(400, "Formato não suportado. Use PNG, JPG, GIF ou WebP.")
        mime = IMAGE_FORMATS[im.format]
        width, height = im.size
        if width * height > 40_000_000:
            raise err(400, "Imagem grande demais.")
        animated = bool(getattr(im, "is_animated", False)) and getattr(im, "n_frames", 1) > 1
        ext = {"image/png": ".png", "image/jpeg": ".jpg", "image/gif": ".gif", "image/webp": ".webp"}[mime]
        if animated:
            still_rel = f"{kind}/{file_id}.still.png"
            still_data = _still_frame(im)
    elif kind == "sound":
        ext = Path(original).suffix.lower()
        if ext not in AUDIO_TYPES:
            raise err(400, "Som precisa ser MP3, OGG, WAV, WEBM ou M4A.")
        mime = AUDIO_TYPES[ext]
    else:
        ext = Path(original).suffix.lower()[:10]
        mime = CLIP_TYPES.get(ext) or mimetypes.guess_type(original)[0] or "application/octet-stream"
        if mime.startswith("image/"):
            try:
                im = Image.open(io.BytesIO(data))
                width, height = im.size
                animated = bool(getattr(im, "is_animated", False))
                mime = IMAGE_FORMATS.get(im.format or "", "application/octet-stream")
            except Exception:
                mime = "application/octet-stream"

    rel = f"{kind}/{file_id}{ext}"
    path = settings.upload_dir / rel
    still_path = settings.upload_dir / still_rel if still_rel else None
    try:
        async with pool().acquire() as con, con.transaction():
            # O lock transacional mantém a cota correta mesmo se outro worker for
            # habilitado no futuro. Ele é liberado automaticamente no commit/rollback.
            await con.execute("SELECT pg_advisory_xact_lock($1)", UPLOAD_ADVISORY_LOCK)
            await enforce_upload_budget(owner_id, len(data) + len(still_data or b""), con)
            path.write_bytes(data)
            if still_path and still_data:
                still_path.write_bytes(still_data)
            await con.execute(
                """INSERT INTO files (id, owner_id, kind, mime, size, stored_size, name, width, height, animated, path, still_path)
                   VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)""",
                file_id, owner_id, kind, mime, len(data), len(data) + len(still_data or b""), original, width, height, animated, rel, still_rel,
            )
    except Exception:
        path.unlink(missing_ok=True)
        if still_path:
            still_path.unlink(missing_ok=True)
        raise
    return {
        "id": sid(file_id),
        "url": file_url(file_id),
        "still": file_url(file_id, still=animated),
        "name": original,
        "mime": mime,
        "size": len(data),
        "width": width,
        "height": height,
        "animated": animated,
    }


@router.post("/files")
async def upload_attachment(file: UploadFile, clip: bool = False, me: Auth = CurrentUser) -> dict[str, Any]:
    """Anexo de mensagem. Sobe primeiro, depois vai junto na mensagem pelo id. `clip=1`: vídeo da call, até 80 MB."""
    return await save_upload(file, "attachment", me.id, clip=clip)


async def _serve(file_id: str, still: bool, me: Auth | None) -> FileResponse:
    row = await pool().fetchrow(
        "SELECT id, owner_id, kind, mime, path, still_path, name FROM files WHERE id = $1", parse_id(file_id)
    )
    if not row:
        raise err(404, "Arquivo não encontrado.")
    public = row["kind"] in PUBLIC_KINDS
    if not await file_access_allowed(row, me):
        # Não diferencie ID inexistente de ID existente sem permissão.
        raise err(404, "Arquivo não encontrado.")
    rel = row["still_path"] if still and row["still_path"] else row["path"]
    path = (settings.upload_dir / rel).resolve()
    if settings.upload_dir not in path.parents or not path.exists():
        raise err(404, "Arquivo não encontrado.")
    mime = "image/png" if still and row["still_path"] else row["mime"]
    inline = mime in INLINE_TYPES
    headers = {
        "Cache-Control": "public, max-age=31536000, immutable" if public else "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; sandbox",
        "Cross-Origin-Resource-Policy": "cross-origin",
    }
    return FileResponse(
        path,
        media_type=mime if inline else "application/octet-stream",
        headers=headers,
        filename=row["name"],
        content_disposition_type="inline" if inline else "attachment",
    )


@router.get("/files/{file_id}")
async def get_file(file_id: str, me: Auth | None = FileUser) -> FileResponse:
    return await _serve(file_id, still=False, me=me)


@router.get("/files/{file_id}/still")
async def get_still(file_id: str, me: Auth | None = FileUser) -> FileResponse:
    return await _serve(file_id, still=True, me=me)
