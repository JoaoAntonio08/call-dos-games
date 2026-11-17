from __future__ import annotations

from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.routes import extras2


class Pool:
    def __init__(self, token_hash: str):
        self.token_hash = token_hash

    async def fetchrow(self, query, *args):
        return {"id": 5, "channel_id": 8, "name": "Bot", "token_hash": self.token_hash}


@pytest.mark.asyncio
async def test_webhook_rejects_missing_header_token(monkeypatch):
    monkeypatch.setattr(extras2, "pool", lambda: Pool(extras2._hash("secret")))
    request = SimpleNamespace(json=lambda: None)
    with pytest.raises(HTTPException) as raised:
        await extras2.run_webhook("5", request, authorization="", x_webhook_token="")
    assert raised.value.status_code == 404


def test_webhook_route_no_longer_accepts_secret_path_segment():
    paths = {route.path for route in extras2.router.routes if "webhooks" in route.path}
    assert "/webhooks/{webhook_id}/{token}" not in paths
    assert "/webhooks/{webhook_id}" in paths


class BodyRequest:
    def __init__(self, chunks: list[bytes], content_type: str = "application/json", content_length: str = ""):
        self.chunks = chunks
        self.headers = {"content-type": content_type}
        if content_length:
            self.headers["content-length"] = content_length

    async def stream(self):
        for chunk in self.chunks:
            yield chunk


@pytest.mark.asyncio
async def test_webhook_body_has_a_hard_streaming_limit():
    request = BodyRequest([b"x" * extras2.WEBHOOK_BODY_LIMIT, b"x"])
    with pytest.raises(HTTPException) as raised:
        await extras2.read_webhook_body(request)
    assert raised.value.status_code == 413


@pytest.mark.asyncio
async def test_webhook_rejects_oversized_content_length_before_reading():
    request = BodyRequest([], content_length=str(extras2.WEBHOOK_BODY_LIMIT + 1))
    with pytest.raises(HTTPException) as raised:
        await extras2.read_webhook_body(request)
    assert raised.value.status_code == 413


@pytest.mark.asyncio
async def test_webhook_accepts_bounded_json_and_urlencoded_forms():
    json_body = await extras2.read_webhook_body(BodyRequest([b'{"content":"ok"}']))
    form_body = await extras2.read_webhook_body(
        BodyRequest([b"content=ok&username=bot"], content_type="application/x-www-form-urlencoded")
    )
    assert json_body == {"content": "ok"}
    assert form_body == {"content": "ok", "username": "bot"}
