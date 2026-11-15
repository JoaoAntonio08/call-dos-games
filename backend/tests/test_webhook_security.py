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
