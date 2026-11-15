"""Configuração, banco, ids e autenticação: o que todo o resto usa."""

from __future__ import annotations

import hashlib
import os
import secrets
import threading
import time
from pathlib import Path
from typing import Any

import asyncpg
import jwt
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerifyMismatchError
from dotenv import load_dotenv
from fastapi import Depends, Header, HTTPException, status

ROOT = Path(__file__).resolve().parent.parent
# CDG_ENV_FILE escolhe outro arquivo (ex.: .env.prod para o servidor da turma no mesmo PC dos testes)
load_dotenv(ROOT / os.environ.get("CDG_ENV_FILE", ".env"))


def env(name: str, default: str = "") -> str:
    return os.environ.get(name, default).strip()


class Settings:
    database_url = env("DATABASE_URL")
    jwt_secret = env("JWT_SECRET")
    public_url = env("PUBLIC_URL", "http://localhost:8000").rstrip("/")
    frontend_url = env("FRONTEND_URL", "http://localhost:3000").rstrip("/")
    cors_origins = [o.strip().rstrip("/") for o in env("CORS_ORIGINS", "http://localhost:3000").split(",") if o.strip()]
    upload_dir = (ROOT / env("UPLOAD_DIR", "./uploads")).resolve()
    upload_user_quota_mb = max(1, int(env("UPLOAD_USER_QUOTA_MB", "500")))
    upload_total_quota_mb = max(upload_user_quota_mb, int(env("UPLOAD_TOTAL_QUOTA_MB", "8192")))
    upload_min_free_mb = max(128, int(env("UPLOAD_MIN_FREE_MB", "1024")))
    upload_rate_per_hour = max(1, int(env("UPLOAD_RATE_PER_HOUR", "60")))
    livekit_url = env("LIVEKIT_URL")
    livekit_key = env("LIVEKIT_API_KEY")
    livekit_secret = env("LIVEKIT_API_SECRET")
    livekit_token_ttl = max(60, min(900, int(env("LIVEKIT_TOKEN_TTL_SECONDS", "300"))))
    google_client_id = env("GOOGLE_CLIENT_ID")
    resend_key = env("RESEND_API_KEY")
    email_from = env("EMAIL_FROM")
    # atrás da Cloudflare todo mundo chega com o IP do proxy; o IP real vem neste cabeçalho
    behind_cloudflare = env("BEHIND_CLOUDFLARE", "0") == "1"
    auth_rate_limit = int(env("AUTH_RATE_LIMIT", "20"))
    # opcionais: busca de GIFs (developers.giphy.com) e "jogando agora" da Steam (steamcommunity.com/dev/apikey)
    giphy_key = env("GIPHY_API_KEY")
    steam_key = env("STEAM_API_KEY")
    # opcional: /tocar pelo nome da música (console.cloud.google.com, YouTube Data API v3)
    youtube_key = env("YOUTUBE_API_KEY")
    # quem administra a plataforma toda (vê o uso de todos os servidores); nomes de usuário separados por vírgula
    platform_admins = {u.strip().lower().lstrip("@") for u in env("PLATFORM_ADMINS", "djpizza").split(",") if u.strip()}


settings = Settings()
if not settings.jwt_secret or len(settings.jwt_secret) < 32:
    raise RuntimeError("JWT_SECRET ausente ou curto demais no .env (use 32+ caracteres aleatórios).")
settings.upload_dir.mkdir(parents=True, exist_ok=True)


def err(code: int, message: str) -> HTTPException:
    return HTTPException(status_code=code, detail=message)


# ------------------------------------------------------------------ ids
# Ids no estilo "snowflake": ordenáveis pelo tempo e únicos no processo.
_EPOCH_MS = 1_767_225_600_000  # 2026-01-01
_lock = threading.Lock()
_last = 0
_seq = 0


def new_id() -> int:
    global _last, _seq
    with _lock:
        now = int(time.time() * 1000) - _EPOCH_MS
        if now == _last:
            _seq = (_seq + 1) & 0xFFF
            if _seq == 0:
                while now <= _last:
                    now = int(time.time() * 1000) - _EPOCH_MS
        else:
            _seq = 0
        _last = now
        return (now << 22) | (os.getpid() & 0x3FF) << 12 | _seq


def sid(v: int | None) -> str | None:
    """Ids saem como texto: números de 64 bits não cabem com precisão no JavaScript."""
    return None if v is None else str(v)


def parse_id(v: str | int | None) -> int:
    try:
        return int(v)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        raise err(400, "Id inválido.")


# ------------------------------------------------------------------ banco
class DB:
    pool: asyncpg.Pool | None = None


db = DB()


async def connect_db() -> None:
    if not settings.database_url:
        raise RuntimeError("DATABASE_URL ausente no .env")
    db.pool = await asyncpg.create_pool(settings.database_url, min_size=1, max_size=10)
    schema = (Path(__file__).parent / "schema.sql").read_text(encoding="utf-8")
    async with db.pool.acquire() as con:
        await con.execute(schema)


async def close_db() -> None:
    if db.pool:
        await db.pool.close()


def pool() -> asyncpg.Pool:
    assert db.pool is not None
    return db.pool


# ------------------------------------------------------------------ senhas e tokens
_ph = PasswordHasher()


def hash_password(pw: str) -> str:
    return _ph.hash(pw)


def check_password(hash_: str | None, pw: str) -> bool:
    if not hash_:
        return False
    try:
        return _ph.verify(hash_, pw)
    except (VerifyMismatchError, InvalidHashError):
        return False


def sha256(s: str) -> str:
    return hashlib.sha256(s.encode()).hexdigest()


def random_token(n: int = 32) -> str:
    return secrets.token_urlsafe(n)


SESSION_DAYS = 60


async def create_session(user_id: int, user_agent: str = "") -> str:
    session_id = new_id()
    await pool().execute(
        "INSERT INTO sessions (id, user_id, user_agent) VALUES ($1, $2, $3)",
        session_id,
        user_id,
        user_agent[:200],
    )
    payload = {"sub": str(user_id), "sid": str(session_id), "iat": int(time.time()), "exp": int(time.time()) + SESSION_DAYS * 86400}
    return jwt.encode(payload, settings.jwt_secret, algorithm="HS256")


async def user_from_token(token: str) -> tuple[int, int] | None:
    """Devolve (user_id, session_id) se o token for válido e a sessão ainda existir."""
    try:
        data = jwt.decode(token, settings.jwt_secret, algorithms=["HS256"])
        uid, session_id = int(data["sub"]), int(data["sid"])
    except Exception:
        return None
    row = await pool().fetchrow("SELECT user_id FROM sessions WHERE id = $1", session_id)
    if not row or row["user_id"] != uid:
        return None
    return uid, session_id


class Auth:
    def __init__(self, user_id: int, session_id: int):
        self.id = user_id
        self.session_id = session_id


async def current(authorization: str = Header(default="")) -> Auth:
    if not authorization.lower().startswith("bearer "):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Faça login para continuar.")
    found = await user_from_token(authorization[7:].strip())
    if not found:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Sua sessão expirou. Entre de novo.")
    return Auth(*found)


CurrentUser = Depends(current)


# ------------------------------------------------------------------ serialização
def file_url(file_id: int | None, still: bool = False) -> str | None:
    if file_id is None:
        return None
    return f"{settings.public_url}/files/{file_id}{'/still' if still else ''}"


def media(file_id: int | None, animated: bool | None) -> dict[str, Any] | None:
    """Imagem de perfil/banner/ícone: url animada + url do quadro parado."""
    if file_id is None:
        return None
    return {"url": file_url(file_id), "still": file_url(file_id, still=bool(animated)), "animated": bool(animated)}


USER_COLUMNS = """
    u.id, u.username, u.display_name, u.bio, u.accent, u.status, u.custom_status, u.pronouns, u.created_at,
    u.name_color, u.theme, u.badges,
    u.avatar_id, av.animated AS avatar_animated,
    u.banner_id, bn.animated AS banner_animated,
    u.join_sound_id
"""
USER_JOINS = """
    LEFT JOIN files av ON av.id = u.avatar_id
    LEFT JOIN files bn ON bn.id = u.banner_id
"""


def user_out(r: asyncpg.Record | dict, presence: str | None = None) -> dict[str, Any]:
    status_ = r["status"]
    return {
        "id": sid(r["id"]),
        "username": r["username"],
        "display_name": r["display_name"],
        "bio": r["bio"],
        "accent": r["accent"],
        "pronouns": r["pronouns"],
        "custom_status": r["custom_status"],
        # quem está invisível aparece como offline para os outros
        "status": presence if presence is not None else status_,
        "avatar": media(r["avatar_id"], r["avatar_animated"]),
        "banner": media(r["banner_id"], r["banner_animated"]),
        "join_sound": file_url(r["join_sound_id"]),
        "name_color": r["name_color"],
        "theme": list(r["theme"] or []),
        "badges": list(r["badges"] or []),
        "created_at": r["created_at"].isoformat(),
    }


async def fetch_user(user_id: int) -> asyncpg.Record | None:
    return await pool().fetchrow(f"SELECT {USER_COLUMNS} FROM users u {USER_JOINS} WHERE u.id = $1", user_id)
