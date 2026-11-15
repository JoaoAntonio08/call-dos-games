from __future__ import annotations

from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.core import Auth, hash_password, settings
from app.routes import auth


class FakePool:
    def __init__(self, *, rows: list[object] | None = None, values: list[object] | None = None):
        self.rows = list(rows or [])
        self.values = list(values or [])
        self.executed: list[tuple[str, tuple[object, ...]]] = []

    async def fetchrow(self, query: str, *args: object):
        return self.rows.pop(0) if self.rows else None

    async def fetchval(self, query: str, *args: object):
        return self.values.pop(0) if self.values else None

    async def execute(self, query: str, *args: object):
        self.executed.append((query, args))


GOOGLE_TOKEN = "x" * 200
GOOGLE_INFO = {
    "sub": "google-stable-subject",
    "email": "owner@example.com",
    "email_verified": True,
    "iss": "https://accounts.google.com",
}


@pytest.mark.asyncio
async def test_google_login_never_links_an_existing_account_by_email(monkeypatch):
    fake = FakePool(rows=[None], values=[1])
    monkeypatch.setattr(auth, "pool", lambda: fake)
    monkeypatch.setattr(auth, "verify_google_credential", lambda _: async_value(GOOGLE_INFO))

    with pytest.raises(HTTPException) as raised:
        await auth.google_login(auth.GoogleIn(credential=GOOGLE_TOKEN), request_stub(), response_stub())

    assert raised.value.status_code == 409
    assert fake.executed == []


@pytest.mark.asyncio
async def test_google_link_requires_password_and_matching_verified_email(monkeypatch):
    password_hash = hash_password("correct horse battery staple")
    fake = FakePool(
        rows=[{"email": "owner@example.com", "password_hash": password_hash, "google_sub": None}],
        values=[None],
    )
    monkeypatch.setattr(auth, "pool", lambda: fake)
    monkeypatch.setattr(auth, "verify_google_credential", lambda _: async_value(GOOGLE_INFO))

    result = await auth.link_google(
        auth.GoogleLinkIn(credential=GOOGLE_TOKEN, password="correct horse battery staple"),
        Auth(42, 7),
    )

    assert result == {"ok": True}
    assert len(fake.executed) == 1
    assert fake.executed[0][1] == ("google-stable-subject", 42)


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("password", "google_email"),
    [("wrong password", "owner@example.com"), ("correct horse battery staple", "other@example.com")],
)
async def test_google_link_rejects_missing_proof(monkeypatch, password, google_email):
    fake = FakePool(
        rows=[{"email": "owner@example.com", "password_hash": hash_password("correct horse battery staple"), "google_sub": None}]
    )
    monkeypatch.setattr(auth, "pool", lambda: fake)
    info = {**GOOGLE_INFO, "email": google_email}
    monkeypatch.setattr(auth, "verify_google_credential", lambda _: async_value(info))

    with pytest.raises(HTTPException) as raised:
        await auth.link_google(auth.GoogleLinkIn(credential=GOOGLE_TOKEN, password=password), Auth(42, 7))

    assert raised.value.status_code in (401, 409)
    assert fake.executed == []


@pytest.mark.asyncio
async def test_forgot_does_not_create_or_log_token_without_mail_service(monkeypatch):
    fake = FakePool(rows=[{"id": 42, "display_name": "Pessoa"}])
    monkeypatch.setattr(auth, "pool", lambda: fake)
    monkeypatch.setattr(settings, "resend_key", "")
    monkeypatch.setattr(settings, "email_from", "")

    assert await auth.forgot(auth.ForgotIn(email="owner@example.com")) == {"ok": True}
    assert fake.executed == []


@pytest.mark.asyncio
async def test_forgot_uses_fragment_and_escapes_email_html(monkeypatch):
    fake = FakePool(rows=[{"id": 42, "display_name": '<img src=x onerror="bad">'}])
    sent: dict = {}

    class MailClient:
        def __init__(self, **_: object):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *_: object):
            return None

        async def post(self, url: str, **kwargs: object):
            sent.update({"url": url, **kwargs})

    monkeypatch.setattr(auth, "pool", lambda: fake)
    monkeypatch.setattr(auth, "random_token", lambda: "secret-reset-token")
    monkeypatch.setattr(auth.httpx, "AsyncClient", MailClient)
    monkeypatch.setattr(settings, "resend_key", "mail-key")
    monkeypatch.setattr(settings, "email_from", "noreply@example.com")

    await auth.forgot(auth.ForgotIn(email="owner@example.com"))

    html = sent["json"]["html"]
    assert "#token=secret-reset-token" in html
    assert "?token=" not in html
    assert "<img" not in html
    assert "&lt;img" in html


def test_official_google_verifier_uses_configured_audience(monkeypatch):
    seen: dict = {}

    def verify(token, request, audience):
        seen.update(token=token, request=request, audience=audience)
        return GOOGLE_INFO

    monkeypatch.setattr(auth.google_id_token, "verify_oauth2_token", verify)

    assert auth._verify_google_credential(GOOGLE_TOKEN)["sub"] == "google-stable-subject"
    assert seen["audience"] == settings.google_client_id


async def async_value(value):
    return value


def request_stub():
    return SimpleNamespace(headers={})


def response_stub():
    return SimpleNamespace(set_cookie=lambda *args, **kwargs: None)
