from __future__ import annotations

import pytest
from fastapi import Response

from app.core import settings
from app.realtime import Hub, websocket_origin_allowed, websocket_session_valid
from app.routes.uso import is_platform_admin


def test_platform_admin_is_fail_closed_and_uses_immutable_id(monkeypatch):
    monkeypatch.setattr(settings, "platform_admin_ids", set())
    assert not is_platform_admin(42)
    monkeypatch.setattr(settings, "platform_admin_ids", {42})
    assert is_platform_admin(42)
    assert not is_platform_admin(43)


def test_browser_websocket_origin_must_be_allowlisted(monkeypatch):
    monkeypatch.setattr(settings, "ws_origins", ["https://call.example"])
    assert websocket_origin_allowed("https://call.example")
    assert websocket_origin_allowed("https://call.example/")
    assert websocket_origin_allowed(None)  # app nativo
    assert not websocket_origin_allowed("https://evil.example")
    assert not websocket_origin_allowed("null")


@pytest.mark.asyncio
async def test_websocket_rechecks_revoked_session(monkeypatch):
    from app import realtime

    monkeypatch.setattr(realtime, "user_from_token", lambda token: async_value((42, 9) if token == "active" else None))
    assert await websocket_session_valid("active", 42)
    assert not await websocket_session_valid("revoked", 42)
    assert not await websocket_session_valid("active", 43)


@pytest.mark.asyncio
async def test_games_are_only_sent_to_current_social_audience(monkeypatch):
    hub = Hub()
    hub.games = {1: {"name": "Own"}, 2: {"name": "Friend"}, 3: {"name": "Stranger"}}
    monkeypatch.setattr(hub, "audience_of", lambda user_id: async_value({1, 2}))
    assert await hub.visible_games(1) == {"1": {"name": "Own"}, "2": {"name": "Friend"}}


@pytest.mark.asyncio
async def test_pending_friendships_are_not_part_of_audience(monkeypatch):
    seen = {}

    class Pool:
        async def fetch(self, query, *args):
            seen["query"] = query
            return []

    from app import realtime

    monkeypatch.setattr(realtime, "pool", lambda: Pool())
    assert await Hub().audience_of(42) == {42}
    assert seen["query"].count("status = 'accepted'") == 2


def test_api_docs_are_disabled_by_default():
    from app.main import app

    paths = {route.path for route in app.routes if hasattr(route, "path")}
    assert "/docs" not in paths
    assert "/openapi.json" not in paths


def test_api_security_headers_disable_cache(monkeypatch):
    from app.main import secure_response

    monkeypatch.setattr(settings, "public_url", "https://api.example")
    response = secure_response(Response())
    assert response.headers["cache-control"] == "no-store"
    assert response.headers["x-content-type-options"] == "nosniff"
    assert response.headers["strict-transport-security"].startswith("max-age=")


async def async_value(value):
    return value
