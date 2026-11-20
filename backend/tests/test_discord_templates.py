from types import SimpleNamespace

import httpx
import pytest
from fastapi import HTTPException

from app.routes import templates


def sample(private=False):
    return {
        "name": "Turma",
        "source_guild_id": "55",
        "serialized_source_guild": {
            "roles": [{"id": 0, "permissions": str(templates.VIEW_CHANNEL)}],
            "channels": [
                {"id": 1, "type": 4, "name": "INFO", "position": 0,
                 "permission_overwrites": [{"id": "55", "type": 0, "deny": str(templates.VIEW_CHANNEL), "allow": "0"}] if private else []},
                {"id": 2, "type": 0, "parent_id": 1, "name": "👋┃boas-vindas", "position": 0},
                {"id": 3, "type": 2, "name": "Conversa", "position": 1, "user_limit": 4},
            ],
        },
    }


def test_code_only_accepts_discord_new():
    assert templates.code_of("https://discord.new/abc123") == "abc123"
    assert templates.code_of("abc123") == "abc123"
    with pytest.raises(HTTPException):
        templates.code_of("https://internal.invalid/abc123")


def test_category_visibility_and_voice_limit():
    result = templates.preview(sample(private=True))
    by_id = {c["id"]: c for c in result["channels"]}
    assert by_id["2"]["category"] == "INFO"
    assert by_id["2"]["private"] is True
    assert by_id["3"]["user_limit"] == 4


def test_private_category_without_channel_overwrites_is_blocked():
    data = sample(private=True)
    data["serialized_source_guild"]["channels"][1]["permission_overwrites"] = []
    assert next(c for c in templates.preview(data)["channels"] if c["id"] == "2")["private"]


@pytest.mark.asyncio
async def test_preview_requires_admin_before_discord_request(monkeypatch):
    async def deny(*args):
        raise HTTPException(403)
    async def must_not_fetch(*args):
        raise AssertionError("external request before authorization")
    monkeypatch.setattr(templates, "require_admin", deny)
    monkeypatch.setattr(templates, "fetch_template", must_not_fetch)
    with pytest.raises(HTTPException) as exc:
        await templates.preview_template("12", templates.PreviewIn(template="abc123"), SimpleNamespace(id=8))
    assert exc.value.status_code == 403


@pytest.mark.asyncio
async def test_discord_api_errors_and_fixed_destination(monkeypatch):
    seen = []
    class Client:
        async def __aenter__(self):
            return self
        async def __aexit__(self, *args):
            pass
        def stream(self, method, url):
            seen.append(url)
            return self
        @property
        def status_code(self):
            return 404
    monkeypatch.setattr(templates.httpx, "AsyncClient", lambda **kwargs: Client())
    with pytest.raises(HTTPException) as exc:
        await templates.fetch_template("abc123")
    assert exc.value.status_code == 404
    assert seen == ["https://discord.com/api/v10/guilds/templates/abc123"]


class Connection:
    def __init__(self, existing=(), linked=False):
        self.existing = existing
        self.linked = linked
        self.inserted = []
        self.deleted = False
    def transaction(self):
        return self
    async def __aenter__(self):
        return self
    async def __aexit__(self, *args):
        pass
    async def execute(self, query, *args):
        if query.startswith("INSERT"):
            self.inserted.append(args)
        if query.startswith("DELETE"):
            self.deleted = True
    async def fetch(self, *args):
        return self.existing
    async def fetchval(self, query, *args):
        if "FROM members" in query:
            return "admin"
        return 1 if self.linked else None


class Pool:
    def __init__(self, conn):
        self.conn = conn
    def acquire(self):
        return self.conn


@pytest.mark.asyncio
async def test_import_skips_duplicate_and_preserves_limit(monkeypatch):
    conn = Connection(existing=[{"id": 9, "type": "text", "name": "👋┃boas-vindas", "position": 0, "view_roles": [], "send_roles": []}])
    async def allowed(*args):
        return "admin"
    async def source(*args):
        return sample()
    async def announce(*args):
        pass
    monkeypatch.setattr(templates, "require_admin", allowed)
    monkeypatch.setattr(templates, "fetch_template", source)
    monkeypatch.setattr(templates, "announce_server", announce)
    monkeypatch.setattr(templates, "pool", lambda: Pool(conn))
    data = templates.preview(sample())
    body = templates.ImportIn(template="abc123", selected=["2", "3"], fingerprint=data["fingerprint"])
    result = await templates.import_template("10", body, SimpleNamespace(id=8))
    assert result == {"created": 1, "selected": 2, "skipped": 1}
    assert conn.inserted[0][-1] == 4


@pytest.mark.asyncio
async def test_import_rejects_private_and_preserves_linked_channels(monkeypatch):
    async def allowed(*args):
        return "admin"
    async def source(*args):
        return sample(private=True)
    monkeypatch.setattr(templates, "require_admin", allowed)
    monkeypatch.setattr(templates, "fetch_template", source)
    conn = Connection(existing=[{"id": 9, "type": "text", "name": "old", "position": 0, "view_roles": [], "send_roles": []}], linked=True)
    monkeypatch.setattr(templates, "pool", lambda: Pool(conn))
    data = templates.preview(sample(private=True))
    with pytest.raises(HTTPException) as exc:
        await templates.import_template("10", templates.ImportIn(template="abc123", selected=["2"], fingerprint=data["fingerprint"]), SimpleNamespace(id=8))
    assert exc.value.status_code == 400
    with pytest.raises(HTTPException) as exc:
        await templates.import_template("10", templates.ImportIn(template="abc123", selected=["3"], mode="replace", fingerprint=data["fingerprint"]), SimpleNamespace(id=8))
    assert exc.value.status_code == 409
    assert conn.deleted is False
