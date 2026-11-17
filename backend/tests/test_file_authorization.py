from __future__ import annotations

from types import SimpleNamespace

import pytest

from app.core import Auth
from app import files


class FakePool:
    def __init__(self, *, values=None, records=None):
        self.values = list(values or [])
        self.records = list(records or [])

    async def fetchval(self, query, *args):
        return self.values.pop(0) if self.values else None

    async def fetch(self, query, *args):
        return self.records.pop(0) if self.records else []


def row(kind="attachment", owner_id=10, file_id=99):
    return {"id": file_id, "owner_id": owner_id, "kind": kind}


@pytest.mark.asyncio
async def test_private_attachment_rejects_anonymous_user(monkeypatch):
    monkeypatch.setattr(files, "pool", lambda: FakePool())
    assert not await files.file_access_allowed(row(), None)


@pytest.mark.asyncio
async def test_attachment_owner_can_read_before_sending(monkeypatch):
    monkeypatch.setattr(files, "pool", lambda: FakePool())
    assert await files.file_access_allowed(row(owner_id=42), Auth(42, 1))


@pytest.mark.asyncio
async def test_other_user_needs_access_to_message_channel(monkeypatch):
    fake = FakePool(records=[[{"channel_id": 123, "visible_to": None}]])
    monkeypatch.setattr(files, "pool", lambda: fake)
    monkeypatch.setattr(files, "can_access_channel", lambda user_id, channel_id: async_value(None))
    assert not await files.file_access_allowed(row(), Auth(42, 1))

    fake = FakePool(records=[[{"channel_id": 123, "visible_to": None}]])
    monkeypatch.setattr(files, "pool", lambda: fake)
    monkeypatch.setattr(files, "can_access_channel", lambda user_id, channel_id: async_value({"id": channel_id}))
    assert await files.file_access_allowed(row(), Auth(42, 1))


@pytest.mark.asyncio
async def test_private_command_attachment_is_visible_only_to_recipient(monkeypatch):
    fake = FakePool(records=[[{"channel_id": 123, "visible_to": 7}]])
    monkeypatch.setattr(files, "pool", lambda: fake)
    monkeypatch.setattr(files, "can_access_channel", lambda user_id, channel_id: async_value({"id": channel_id}))
    assert not await files.file_access_allowed(row(), Auth(42, 1))


@pytest.mark.asyncio
async def test_public_profile_media_stays_public(monkeypatch):
    monkeypatch.setattr(files, "pool", lambda: FakePool())
    assert await files.file_access_allowed(row(kind="avatar"), None)


@pytest.mark.asyncio
async def test_sticker_requires_collection_or_visible_message(monkeypatch):
    fake = FakePool(values=[None], records=[[]])
    monkeypatch.setattr(files, "pool", lambda: fake)
    assert not await files.file_access_allowed(row(kind="sticker"), Auth(42, 1))

    fake = FakePool(values=[1])
    monkeypatch.setattr(files, "pool", lambda: fake)
    assert await files.file_access_allowed(row(kind="sticker"), Auth(42, 1))


@pytest.mark.asyncio
async def test_file_cookie_is_validated_against_live_session(monkeypatch):
    monkeypatch.setattr(files, "user_from_token", lambda token: async_value((42, 9) if token == "valid" else None))
    found = await files.file_user(authorization="", cdg_session="valid")
    missing = await files.file_user(authorization="", cdg_session="revoked")
    assert (found.id, found.session_id) == (42, 9)
    assert missing is None


async def async_value(value):
    return value
