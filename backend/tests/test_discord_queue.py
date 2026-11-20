import asyncio

import pytest

from app.routes.discord import QUEUE_CAPACITY, WORKERS, _Ponte


@pytest.mark.asyncio
async def test_discord_queue_saturates_and_recovers():
    bridge = _Ponte()
    running = asyncio.Event()
    release = asyncio.Event()

    async def job():
        if bridge.active == WORKERS:
            running.set()
        await release.wait()

    bridge.workers = [asyncio.create_task(bridge.work()) for _ in range(WORKERS)]
    try:
        for _ in range(WORKERS):
            bridge.submit(job)
        await asyncio.wait_for(running.wait(), 2)
        for _ in range(QUEUE_CAPACITY + 3):
            bridge.submit(job)
        assert bridge.active == WORKERS
        assert bridge.queue.qsize() == QUEUE_CAPACITY
        assert bridge.dropped == 3
        release.set()
        await asyncio.wait_for(bridge.queue.join(), 2)
        bridge.submit(job)
        await asyncio.wait_for(bridge.queue.join(), 2)
        assert bridge.dropped == 3
    finally:
        await bridge.stop()
    assert bridge.active == 0
    assert bridge.queue.empty()
