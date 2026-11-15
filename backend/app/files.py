"""Uploads: fotos e banners (estáticos ou animados), ícones, emojis, sons e anexos."""

from __future__ import annotations

import io
import mimetypes
from pathlib import Path
from typing import Any

from fastapi import APIRouter, UploadFile
from fastapi.responses import FileResponse
from PIL import Image, ImageSequence

from .core import CurrentUser, Auth, err, file_url, new_id, parse_id, pool, settings, sid

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
            (settings.upload_dir / still_rel).write_bytes(_still_frame(im))
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
    (settings.upload_dir / rel).write_bytes(data)
    await pool().execute(
        """INSERT INTO files (id, owner_id, kind, mime, size, name, width, height, animated, path, still_path)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)""",
        file_id, owner_id, kind, mime, len(data), original, width, height, animated, rel, still_rel,
    )
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


async def _serve(file_id: str, still: bool) -> FileResponse:
    row = await pool().fetchrow("SELECT mime, path, still_path, name FROM files WHERE id = $1", parse_id(file_id))
    if not row:
        raise err(404, "Arquivo não encontrado.")
    rel = row["still_path"] if still and row["still_path"] else row["path"]
    path = (settings.upload_dir / rel).resolve()
    if settings.upload_dir not in path.parents or not path.exists():
        raise err(404, "Arquivo não encontrado.")
    mime = "image/png" if still and row["still_path"] else row["mime"]
    inline = mime in INLINE_TYPES
    headers = {
        "Cache-Control": "public, max-age=31536000, immutable",
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
async def get_file(file_id: str) -> FileResponse:
    return await _serve(file_id, still=False)


@router.get("/files/{file_id}/still")
async def get_still(file_id: str) -> FileResponse:
    return await _serve(file_id, still=True)
