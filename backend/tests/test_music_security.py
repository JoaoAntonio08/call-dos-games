from __future__ import annotations

import pytest
from fastapi import HTTPException

from app.core import Auth
from app.realtime import Hub
from app.routes import extras, musica


async def async_value(value):
    return value


@pytest.mark.asyncio
async def test_music_state_ignores_client_supplied_owner(monkeypatch):
    test_hub = Hub()
    test_hub.user_voice[42] = 9
    sent: list[dict] = []

    async def capture(_channel_id, _event, data):
        sent.append(data)

    monkeypatch.setattr(musica, "hub", test_hub)
    monkeypatch.setattr(test_hub, "to_channel", capture)
    monkeypatch.setattr(musica, "youtube_info", lambda _video_id: async_value(("Synthetic title", "Synthetic author")))
    monkeypatch.setattr(
        musica,
        "fetch_user",
        lambda user_id: async_value({"id": user_id, "display_name": f"User {user_id}"}),
    )

    await musica.now_playing(
        musica.NowPlayingIn(channel_id="9", video_id="abcdefghijk", owner_id="99"),
        Auth(42, 1),
    )

    assert test_hub.music[9]["owner_id"] == "42"
    assert test_hub.music[9]["owner_name"] == "User 42"
    assert sent[-1]["music"]["owner_id"] == "42"


@pytest.mark.asyncio
async def test_music_state_uses_server_recorded_queue_owner(monkeypatch):
    test_hub = Hub()
    test_hub.user_voice[42] = 9
    test_hub.expect_music(9, "abcdefghijk", 99)

    monkeypatch.setattr(musica, "hub", test_hub)
    monkeypatch.setattr(test_hub, "to_channel", lambda *_args: async_value(None))
    monkeypatch.setattr(musica, "youtube_info", lambda _video_id: async_value(("Synthetic title", "Synthetic author")))
    monkeypatch.setattr(
        musica,
        "fetch_user",
        lambda user_id: async_value({"id": user_id, "display_name": f"User {user_id}"}),
    )

    await musica.now_playing(
        musica.NowPlayingIn(channel_id="9", video_id="abcdefghijk", owner_id="123"),
        Auth(42, 1),
    )

    assert test_hub.music[9]["owner_id"] == "99"
    assert test_hub.music[9]["owner_name"] == "User 99"
    assert 9 not in test_hub.music_expected


@pytest.mark.asyncio
async def test_regular_participant_cannot_replace_or_clear_active_music(monkeypatch):
    test_hub = Hub()
    test_hub.user_voice.update({42: 9, 77: 9, 99: 9})
    test_hub.music[9] = {
        "video_id": "abcdefghijk",
        "owner_id": "99",
        "owner_name": "User 99",
        "playing": True,
    }
    test_hub.music_controllers[9] = 42

    class Pool:
        async def fetchrow(self, _query, *_args):
            return {"server_id": 5}

    monkeypatch.setattr(musica, "hub", test_hub)
    monkeypatch.setattr(musica, "pool", lambda: Pool())
    monkeypatch.setattr(musica, "perms_member", lambda *_args: async_value(None))

    with pytest.raises(HTTPException) as replace:
        await musica.now_playing(
            musica.NowPlayingIn(channel_id="9", video_id="zyxwvutsrqp", owner_id="77"),
            Auth(77, 2),
        )
    assert replace.value.status_code == 403

    with pytest.raises(HTTPException) as clear:
        await musica.now_playing(musica.NowPlayingIn(channel_id="9", video_id=None), Auth(77, 2))
    assert clear.value.status_code == 403
    assert test_hub.music[9]["video_id"] == "abcdefghijk"


@pytest.mark.asyncio
async def test_playing_queue_item_records_owner_before_deletion(monkeypatch):
    test_hub = Hub()
    executed: list[tuple[str, tuple]] = []

    class Pool:
        async def fetchrow(self, _query, *_args):
            return {"id": 100, "channel_id": 9, "video_id": "abcdefghijk", "added_by": 99}

        async def execute(self, query, *args):
            executed.append((query, args))

    monkeypatch.setattr(extras, "hub", test_hub)
    monkeypatch.setattr(extras, "pool", lambda: Pool())
    monkeypatch.setattr(extras, "can_access_channel", lambda *_args: async_value({"id": 9, "type": "voice"}))
    monkeypatch.setattr(extras, "announce_queue", lambda _channel_id: async_value([]))

    await extras.remove_from_queue("100", played=1, me=Auth(42, 1))

    assert test_hub.consume_expected_music(9, "abcdefghijk") == 99
    assert any(query.startswith("DELETE FROM queue_items") for query, _args in executed)
