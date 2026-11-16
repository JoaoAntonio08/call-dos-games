"""Contas: cadastro com e-mail e senha, login com Google, recuperação de senha."""

from __future__ import annotations

import asyncio
import re
import unicodedata
from datetime import datetime, timedelta, timezone
from html import escape

import asyncpg
import httpx
from fastapi import APIRouter, Request, Response
from google.auth.exceptions import GoogleAuthError
from google.auth.transport import requests as google_requests
from google.oauth2 import id_token as google_id_token
from pydantic import BaseModel, Field

from ..core import (
    Auth, CurrentUser, check_password, create_session, err, fetch_user, hash_password, new_id, pool,
    random_token, settings, sha256, user_out,
)

router = APIRouter(prefix="/auth")

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


def set_session_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        "cdg_session",
        token,
        max_age=60 * 86400,
        secure=settings.public_url.startswith("https://"),
        httponly=True,
        samesite="lax",
        path="/",
    )


async def session_payload(user_id: int, request: Request, response: Response) -> dict:
    token = await create_session(user_id, request.headers.get("user-agent", ""))
    set_session_cookie(response, token)
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
async def register(body: RegisterIn, request: Request, response: Response) -> dict:
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
    return await session_payload(uid, request, response)


class LoginIn(BaseModel):
    login: str  # e-mail ou usuário
    password: str


@router.post("/login")
async def login(body: LoginIn, request: Request, response: Response) -> dict:
    who = body.login.strip().lower().lstrip("@")
    row = await pool().fetchrow(
        "SELECT id, password_hash FROM users WHERE lower(email) = $1 OR lower(username) = $1", who
    )
    if not row or not check_password(row["password_hash"], body.password):
        if row and not row["password_hash"]:
            raise err(401, "Essa conta entra com o Google. Use o botão do Google.")
        raise err(401, "Usuário ou senha incorretos.")
    return await session_payload(row["id"], request, response)


class GoogleIn(BaseModel):
    credential: str = Field(min_length=100, max_length=8192)


def _verify_google_credential(credential: str) -> dict:
    """Valida assinatura, emissor, expiração e audience usando a biblioteca oficial."""
    try:
        info = google_id_token.verify_oauth2_token(
            credential,
            google_requests.Request(),
            settings.google_client_id,
        )
    except (GoogleAuthError, ValueError):
        raise err(401, "O Google não confirmou o login. Tente de novo.")
    if info.get("iss") not in ("accounts.google.com", "https://accounts.google.com") or not info.get("sub"):
        raise err(401, "Login do Google inválido para este site.")
    return info


async def verify_google_credential(credential: str) -> dict:
    # A verificação pode buscar/atualizar as chaves públicas; não bloqueie o event loop.
    return await asyncio.to_thread(_verify_google_credential, credential)


@router.post("/google")
async def google_login(body: GoogleIn, request: Request, response: Response) -> dict:
    if not settings.google_client_id:
        raise err(400, "Login com Google não está configurado neste servidor.")
    info = await verify_google_credential(body.credential)
    google_sub = info["sub"]
    email = (info.get("email") or "").lower()
    verified = info.get("email_verified") is True or str(info.get("email_verified")).lower() == "true"

    row = await pool().fetchrow("SELECT id FROM users WHERE google_sub = $1", google_sub)
    if row:
        return await session_payload(row["id"], request, response)
    if not email or not verified:
        raise err(401, "O Google não confirmou este e-mail.")

    # E-mail coincidente não prova posse de uma conta local. A vinculação explícita
    # exige sessão autenticada e a senha atual no endpoint abaixo.
    if await pool().fetchval("SELECT 1 FROM users WHERE lower(email) = $1", email):
        raise err(409, "Já existe uma conta com esse e-mail. Entre com a senha e vincule o Google nas configurações.")
    uid = new_id()
    display = (info.get("given_name") or info.get("name") or email.split("@")[0] or "Pessoa")[:32]
    username = await unique_username(email.split("@")[0] if email else display)
    await pool().execute(
        "INSERT INTO users (id, username, display_name, email, google_sub) VALUES ($1,$2,$3,$4,$5)",
        uid, username, display, email, google_sub,
    )
    out = await session_payload(uid, request, response)
    out["new_account"] = True
    return out


class GoogleLinkIn(GoogleIn):
    password: str = Field(min_length=1, max_length=200)


@router.post("/google/link")
async def link_google(body: GoogleLinkIn, me: Auth = CurrentUser) -> dict:
    if not settings.google_client_id:
        raise err(400, "Login com Google não está configurado neste servidor.")
    row = await pool().fetchrow("SELECT email, password_hash, google_sub FROM users WHERE id = $1", me.id)
    if not row or not row["password_hash"] or not check_password(row["password_hash"], body.password):
        raise err(401, "Senha atual incorreta.")
    if row["google_sub"]:
        raise err(409, "Esta conta já está ligada ao Google.")
    info = await verify_google_credential(body.credential)
    email = (info.get("email") or "").lower()
    verified = info.get("email_verified") is True or str(info.get("email_verified")).lower() == "true"
    if not verified or not row["email"] or email != row["email"].lower():
        raise err(409, "Use no Google o mesmo e-mail verificado desta conta.")
    if await pool().fetchval("SELECT 1 FROM users WHERE google_sub = $1", info["sub"]):
        raise err(409, "Esta identidade Google já pertence a outra conta.")
    await pool().execute("UPDATE users SET google_sub = $1 WHERE id = $2", info["sub"], me.id)
    return {"ok": True}


@router.post("/logout")
async def logout(response: Response, me: Auth = CurrentUser) -> dict:
    await pool().execute("DELETE FROM sessions WHERE id = $1", me.session_id)
    response.delete_cookie(
        "cdg_session", path="/", secure=settings.public_url.startswith("https://"), httponly=True, samesite="lax"
    )
    return {"ok": True}


class ForgotIn(BaseModel):
    email: str


@router.post("/forgot")
async def forgot(body: ForgotIn) -> dict:
    email = body.email.strip().lower()
    row = await pool().fetchrow("SELECT id, display_name FROM users WHERE lower(email) = $1", email)
    # resposta igual exista ou não a conta, para não revelar quem está cadastrado
    if row and settings.resend_key and settings.email_from:
        token = random_token()
        await pool().execute(
            "INSERT INTO password_resets (token_hash, user_id, expires_at) VALUES ($1, $2, $3)",
            sha256(token), row["id"], datetime.now(timezone.utc) + timedelta(hours=1),
        )
        # O fragmento não é enviado ao servidor web nem aparece em access logs/referrers.
        link = f"{settings.frontend_url}/redefinir-senha#token={token}"
        safe_link = escape(link, quote=True)
        async with httpx.AsyncClient(timeout=10) as client:
            await client.post(
                "https://api.resend.com/emails",
                headers={"Authorization": f"Bearer {settings.resend_key}"},
                json={
                    "from": settings.email_from,
                    "to": [email],
                    "subject": "Trocar sua senha · Call dos Games",
                    "html": (
                        f"<p>Oi, {escape(row['display_name'])}!</p><p>Para criar uma senha nova, abra este link "
                        f"(vale por 1 hora):</p><p><a href=\"{safe_link}\">{safe_link}</a></p>"
                        "<p>Se não foi você, é só ignorar este e-mail.</p>"
                    ),
                },
            )
    return {"ok": True}


class ResetIn(BaseModel):
    token: str = Field(min_length=20, max_length=512)
    password: str


async def consume_password_reset(token_hash: str, password_hash: str) -> int | None:
    """Consome o token e troca a senha uma única vez, mesmo com pedidos concorrentes."""
    async with pool().acquire() as con, con.transaction():
        row = await con.fetchrow(
            """UPDATE password_resets SET used = TRUE
               WHERE token_hash = $1 AND NOT used AND expires_at > now()
               RETURNING user_id""",
            token_hash,
        )
        if not row:
            return None
        user_id = int(row["user_id"])
        await con.execute("UPDATE users SET password_hash = $1 WHERE id = $2", password_hash, user_id)
        await con.execute("DELETE FROM sessions WHERE user_id = $1", user_id)
        return user_id


@router.post("/reset")
async def reset(body: ResetIn, request: Request, response: Response) -> dict:
    validate_password(body.password)
    user_id = await consume_password_reset(sha256(body.token), hash_password(body.password))
    if user_id is None:
        raise err(400, "Esse link expirou ou já foi usado. Peça outro.")
    return await session_payload(user_id, request, response)


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
