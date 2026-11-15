from __future__ import annotations

from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app import files
from app.core import settings


class Pool:
    def __init__(self, user_bytes=0, recent=0, total=0):
        self.user_bytes = user_bytes
        self.recent = recent
        self.total = total

    async def fetchrow(self, query, *args):
        return {"bytes": self.user_bytes, "recent": self.recent}

    async def fetchval(self, query, *args):
        return self.total


def configure(monkeypatch):
    monkeypatch.setattr(settings, "upload_user_quota_mb", 10)
    monkeypatch.setattr(settings, "upload_total_quota_mb", 100)
    monkeypatch.setattr(settings, "upload_min_free_mb", 1)
    monkeypatch.setattr(settings, "upload_rate_per_hour", 5)
    monkeypatch.setattr(files.shutil, "disk_usage", lambda path: SimpleNamespace(free=1_000 * files.MB))


@pytest.mark.asyncio
async def test_upload_within_all_budgets_is_allowed(monkeypatch):
    configure(monkeypatch)
    monkeypatch.setattr(files, "pool", lambda: Pool(user_bytes=files.MB, recent=1, total=10 * files.MB))
    await files.enforce_upload_budget(42, files.MB)


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("pool", "incoming", "status"),
    [
        (Pool(user_bytes=9 * files.MB), 2 * files.MB, 413),
        (Pool(recent=5), files.MB, 429),
        (Pool(total=99 * files.MB), 2 * files.MB, 507),
    ],
)
async def test_upload_budget_rejects_without_consuming_resources(monkeypatch, pool, incoming, status):
    configure(monkeypatch)
    monkeypatch.setattr(files, "pool", lambda: pool)
    with pytest.raises(HTTPException) as raised:
        await files.enforce_upload_budget(42, incoming)
    assert raised.value.status_code == status


@pytest.mark.asyncio
async def test_upload_preserves_minimum_free_disk(monkeypatch):
    configure(monkeypatch)
    monkeypatch.setattr(files, "pool", lambda: Pool())
    monkeypatch.setattr(files.shutil, "disk_usage", lambda path: SimpleNamespace(free=files.MB + 100))
    with pytest.raises(HTTPException) as raised:
        await files.enforce_upload_budget(42, 101)
    assert raised.value.status_code == 507
