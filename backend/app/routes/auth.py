"""Contas: cadastro com e-mail e senha, login com Google, recuperação de senha."""

from __future__ import annotations

import logging
import re
import unicodedata
from datetime import datetime, timedelta, timezone

import asyncpg
import httpx
from fastapi import APIRouter, Request
from pydantic import BaseModel

from ..core import (
    Auth, CurrentUser, check_password, create_session, err, fetch_user, hash_password, new_id, pool,
    random_token, settings, sha256, user_out,
)

router = APIRouter(prefix="/auth")
log = logging.getLogger("calldosgames")

USERNAME_RE = re.compile(r"^[a-z0-9_.]{2,32}$")
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def clean_username(s: str) -> str:
    return s.strip().lower().lstrip("@")


def validate_username(u: str) -> str:
    u = clean_username(u)
    if not USERNAME_RE.match(u):
        raise err(400, "Nome de usuário: 2 a 32 caracteres, só letras minúsculas, números, ponto e _.")
    return u


def validate_password(pw: str) -> None:
    if len(pw) < 8:
        raise err(400, "A senha precisa ter pelo menos 8 caracteres.")
    if len(pw) > 200:
        raise err(400, "Senha longa demais.")


def slugify_name(s: str) -> str:
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode().lower()
    s = re.sub(r"[^a-z0-9_.]+", "", s)
    return s[:24] or "pessoa"


async def unique_username(base: str) -> str:
    base = slugify_name(base)
    if len(base) < 2:
        base = "pessoa"
    candidate = base
    n = 1
    while await pool().fetchval("SELECT 1 FROM users WHERE lower(username) = $1", candidate):
        n += 1
        candidate = f"{base}{n}"
    return candidate


async def session_payload(user_id: int, request: Request) -> dict:
    token = await create_session(user_id, request.headers.get("user-agent", ""))
    user = await fetch_user(user_id)
    assert user
    return {"token": token, "user": user_out(user)}


@router.get("/config")
async def auth_config() -> dict:
    return {"google_client_id": settings.google_client_id or None, "email_enabled": bool(settings.resend_key and settings.email_from)}


class RegisterIn(BaseModel):
    email: str
    username: str
    display_name: str = ""
    password: str


@router.post("/register")
async def register(body: RegisterIn, request: Request) -> dict:
    email = body.email.strip().lower()
    if not EMAIL_RE.match(email) or len(email) > 200:
        raise err(400, "E-mail inválido.")
    username = validate_username(body.username)
    validate_password(body.password)
    display = (body.display_name.strip() or username)[:32]
    uid = new_id()
    try:
        await pool().execute(
            "INSERT INTO users (id, username, display_name, email, password_hash) VALUES ($1,$2,$3,$4,$5)",
            uid, username, display, email, hash_password(body.password),
        )
    except asyncpg.UniqueViolationError as e:
        if "email" in str(e):
            raise err(409, "Já existe uma conta com esse e-mail.")
        raise err(409, "Esse nome de usuário já está em uso.")
    return await session_payload(uid, request)


class LoginIn(BaseModel):
    login: str  # e-mail ou usuário
    password: str


@router.post("/login")
async def login(body: LoginIn, request: Request) -> dict:
    who = body.login.strip().lower().lstrip("@")
    row = await pool().fetchrow(
        "SELECT id, password_hash FROM users WHERE lower(email) = $1 OR lower(username) = $1", who
    )
    if not row or not check_password(row["password_hash"], body.password):
        if row and not row["password_hash"]:
            raise err(401, "Essa conta entra com o Google. Use o botão do Google.")
        raise err(401, "Usuário ou senha incorretos.")
    return await session_payload(row["id"], request)


class GoogleIn(BaseModel):
    credential: str


@router.post("/google")
async def google_login(body: GoogleIn, request: Request) -> dict:
    if not settings.google_client_id:
        raise err(400, "Login com Google não está configurado neste servidor.")
    async with httpx.AsyncClient(timeout=10) as client:
        r = await client.get("https://oauth2.googleapis.com/tokeninfo", params={"id_token": body.credential})
    if r.status_code != 200:
        raise err(401, "O Google não confirmou o login. Tente de novo.")
    info = r.json()
    if info.get("aud") != settings.google_client_id or info.get("iss") not in ("accounts.google.com", "https://accounts.google.com"):
        raise err(401, "Login do Google inválido para este site.")
    google_sub = info["sub"]
    email = (info.get("email") or "").lower()
    verified = str(info.get("email_verified")).lower() == "true"

    row = await pool().fetchrow("SELECT id FROM users WHERE google_sub = $1", google_sub)
    if row:
        return await session_payload(row["id"], request)
    if email and verified:
        row = await pool().fetchrow("SELECT id FROM users WHERE lower(email) = $1", email)
        if row:  # conta criada com senha e mesmo e-mail: liga as duas
            await pool().execute("UPDATE users SET google_sub = $1 WHERE id = $2", google_sub, row["id"])
            return await session_payload(row["id"], request)
    uid = new_id()
    display = (info.get("given_name") or info.get("name") or email.split("@")[0] or "Pessoa")[:32]
    username = await unique_username(email.split("@")[0] if email else display)
    await pool().execute(
        "INSERT INTO users (id, username, display_name, email, google_sub) VALUES ($1,$2,$3,$4,$5)",
        uid, username, display, email if verified else None, google_sub,
    )
    out = await session_payload(uid, request)
    out["new_account"] = True
    return out


@router.post("/logout")
async def logout(me: Auth = CurrentUser) -> dict:
    await pool().execute("DELETE FROM sessions WHERE id = $1", me.session_id)
    return {"ok": True}


class ForgotIn(BaseModel):
    email: str


@router.post("/forgot")
async def forgot(body: ForgotIn) -> dict:
    email = body.email.strip().lower()
    row = await pool().fetchrow("SELECT id, display_name FROM users WHERE lower(email) = $1", email)
    # resposta igual exista ou não a conta, para não revelar quem está cadastrado
    if row:
        token = random_token()
        await pool().execute(
            "INSERT INTO password_resets (token_hash, user_id, expires_at) VALUES ($1, $2, $3)",
            sha256(token), row["id"], datetime.now(timezone.utc) + timedelta(hours=1),
        )
        link = f"{settings.frontend_url}/redefinir-senha?token={token}"
        if settings.resend_key and settings.email_from:
            async with httpx.AsyncClient(timeout=10) as client:
                await client.post(
                    "https://api.resend.com/emails",
                    headers={"Authorization": f"Bearer {settings.resend_key}"},
                    json={
                        "from": settings.email_from,
                        "to": [email],
                        "subject": "Trocar sua senha · Call dos Games",
                        "html": (
                            f"<p>Oi, {row['display_name']}!</p><p>Para criar uma senha nova, abra este link "
                            f"(vale por 1 hora):</p><p><a href=\"{link}\">{link}</a></p>"
                            "<p>Se não foi você, é só ignorar este e-mail.</p>"
                        ),
                    },
                )
        else:
            # sem serviço de e-mail configurado: o link aparece no terminal do servidor
            log.warning("Link de troca de senha para %s: %s", email, link)
    return {"ok": True}


class ResetIn(BaseModel):
    token: str
    password: str


@router.post("/reset")
async def reset(body: ResetIn, request: Request) -> dict:
    validate_password(body.password)
    row = await pool().fetchrow(
        "SELECT user_id FROM password_resets WHERE token_hash = $1 AND NOT used AND expires_at > now()", sha256(body.token)
    )
    if not row:
        raise err(400, "Esse link expirou ou já foi usado. Peça outro.")
    async with pool().acquire() as con, con.transaction():
        await con.execute("UPDATE password_resets SET used = TRUE WHERE token_hash = $1", sha256(body.token))
        await con.execute("UPDATE users SET password_hash = $1 WHERE id = $2", hash_password(body.password), row["user_id"])
        await con.execute("DELETE FROM sessions WHERE user_id = $1", row["user_id"])
    return await session_payload(row["user_id"], request)


class PasswordIn(BaseModel):
    current: str = ""
    new: str


@router.post("/password")
async def change_password(body: PasswordIn, me: Auth = CurrentUser) -> dict:
    validate_password(body.new)
    current_hash = await pool().fetchval("SELECT password_hash FROM users WHERE id = $1", me.id)
    if current_hash and not check_password(current_hash, body.current):
        raise err(400, "Senha atual incorreta.")
    await pool().execute("UPDATE users SET password_hash = $1 WHERE id = $2", hash_password(body.new), me.id)
    await pool().execute("DELETE FROM sessions WHERE user_id = $1 AND id <> $2", me.id, me.session_id)
    return {"ok": True}
