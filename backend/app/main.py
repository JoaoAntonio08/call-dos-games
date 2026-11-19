"""Call dos Games: API.

Rodar no PC:   .venv\\Scripts\\uvicorn app.main:app --reload --port 8000
No servidor:   uvicorn app.main:app --host 127.0.0.1 --port 8000 --proxy-headers (1 worker só)
"""

from __future__ import annotations

import asyncio
import time
from collections import defaultdict, deque
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from .core import close_db, connect_db, settings
from .files import router as files_router
from .realtime import router as realtime_router
from .routes.auth import router as auth_router
from .routes.extras import router as extras_router
from .routes.messages import router as messages_router
from .routes.servers import router as servers_router
from .routes.session import router as session_router
from .routes.users import router as users_router
from .routes.voz import router as voz_router
from .routes.extras2 import router as extras2_router, steam_loop
from .routes.comandos import router as comandos_router
from .routes.bots import router as bots_router, reminder_loop
from .routes.messages import expire_loop
from .routes.uso import router as uso_router, expire_loop as share_expire_loop
from .routes.musica import router as musica_router
from .routes.jogos import free_games_loop
from .routes.discord import router as discord_router, discord_loop
from .routes.noites import router as noites_router, noites_loop


@asynccontextmanager
async def lifespan(_: FastAPI):
    await connect_db()
    loop = asyncio.create_task(steam_loop()) if settings.steam_key else None
    chores = [asyncio.create_task(expire_loop()), asyncio.create_task(reminder_loop()), asyncio.create_task(share_expire_loop()), asyncio.create_task(free_games_loop()), asyncio.create_task(discord_loop()), asyncio.create_task(noites_loop())]
    yield
    if loop:
        loop.cancel()
    for t in chores:
        t.cancel()
    await close_db()


app = FastAPI(
    title="Call dos Games",
    lifespan=lifespan,
    docs_url="/docs" if settings.api_docs else None,
    redoc_url=None,
    openapi_url="/openapi.json" if settings.api_docs else None,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# freio simples contra chute de senha: AUTH_RATE_LIMIT tentativas por IP a cada 10 minutos
_attempts: dict[str, deque[float]] = defaultdict(deque)
_LIMITED = {
    "/auth/login",
    "/auth/register",
    "/auth/google",
    "/auth/google/link",
    "/auth/forgot",
    "/auth/reset",
    "/auth/password",
}


def secure_response(response):
    response.headers.setdefault("Cache-Control", "no-store")
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("Referrer-Policy", "no-referrer")
    response.headers.setdefault("X-Frame-Options", "DENY")
    response.headers.setdefault("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'; sandbox")
    if settings.public_url.startswith("https://"):
        response.headers.setdefault("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
    return response


@app.middleware("http")
async def rate_limit(request: Request, call_next):
    if request.method == "POST" and request.url.path in _LIMITED:
        ip = request.client.host if request.client else "?"
        if settings.behind_cloudflare:
            ip = request.headers.get("cf-connecting-ip", ip)
        q = _attempts[ip]
        now = time.monotonic()
        while q and now - q[0] > 600:
            q.popleft()
        if len(q) >= settings.auth_rate_limit:
            return secure_response(JSONResponse({"error": "Muitas tentativas. Espere uns minutos e tente de novo."}, status_code=429))
        q.append(now)
    response = await call_next(request)
    return secure_response(response)


@app.exception_handler(StarletteHTTPException)
async def http_error(_: Request, exc: StarletteHTTPException) -> JSONResponse:
    return JSONResponse({"error": exc.detail}, status_code=exc.status_code, headers=getattr(exc, "headers", None))


@app.exception_handler(RequestValidationError)
async def validation_error(_: Request, exc: RequestValidationError) -> JSONResponse:
    first = exc.errors()[0] if exc.errors() else {}
    field = ".".join(str(x) for x in first.get("loc", [])[1:])
    return JSONResponse({"error": f"Dados inválidos no pedido ({field or 'corpo'})."}, status_code=422)


@app.get("/health")
async def health() -> dict:
    return {"ok": True}


for r in (auth_router, users_router, servers_router, messages_router, extras_router, session_router, files_router, realtime_router, voz_router, extras2_router, comandos_router, bots_router, uso_router, musica_router, discord_router, noites_router):
    app.include_router(r)
