from __future__ import annotations

from types import SimpleNamespace

import jwt
import pytest
from fastapi import HTTPException

from app.core import Auth, settings
from app.routes import session, voz


@pytest.mark.asyncio
async def test_voice_token_is_short_lived_and_cannot_publish_to_read_only_channel(monkeypatch):
    monkeypatch.setattr(settings, "livekit_url", "wss://voice.test")
    monkeypatch.setattr(settings, "livekit_key", "key")
    monkeypatch.setattr(settings, "livekit_secret", "test-livekit-secret-that-is-long-enough")
    monkeypatch.setattr(settings, "livekit_token_ttl", 300)
    monkeypatch.setattr(
        session,
        "can_access_channel",
        lambda user_id, channel_id: async_value({"id": channel_id, "type": "voice", "server_id": 5, "can_send": False}),
    )
    monkeypatch.setattr(session, "fetch_user", lambda user_id: async_value({"id": user_id}))
    monkeypatch.setattr(
        session,
        "user_out",
        lambda user: {"display_name": "Synthetic", "avatar": None, "accent": "#000000", "username": "synthetic", "join_sound": None},
    )
    monkeypatch.setattr(voz, "mods_of", lambda server_id, user_id: async_value({"mute": False, "deaf": False, "noshare": False}))

    result = await session.voice_token(session.VoiceIn(channel_id="9"), Auth(42, 1))
    claims = jwt.decode(result["token"], settings.livekit_secret, algorithms=["HS256"], options={"verify_aud": False})

    assert claims["exp"] - claims["nbf"] <= 310
    assert claims["video"]["room"] == "cdg-9"
    assert claims["video"]["canPublish"] is False
    assert claims["video"]["canPublishData"] is False


@pytest.mark.asyncio
async def test_voice_token_requires_current_channel_access(monkeypatch):
    monkeypatch.setattr(settings, "livekit_url", "wss://voice.test")
    monkeypatch.setattr(settings, "livekit_key", "key")
    monkeypatch.setattr(settings, "livekit_secret", "test-livekit-secret-that-is-long-enough")
    monkeypatch.setattr(session, "can_access_channel", lambda user_id, channel_id: async_value(None))

    with pytest.raises(HTTPException) as raised:
        await session.voice_token(session.VoiceIn(channel_id="9"), Auth(42, 1))
    assert raised.value.status_code == 404


@pytest.mark.asyncio
async def test_permission_refresh_revokes_participant_without_access(monkeypatch):
    revoked: list[tuple[int, int]] = []
    monkeypatch.setattr(voz, "can_access_channel", lambda user_id, channel_id: async_value(None))

    async def revoke(channel_id, user_id, reason):
        revoked.append((channel_id, user_id))

    monkeypatch.setattr(voz, "revoke_voice_participant", revoke)
    await voz.apply_permissions(9, 42, {"mute": False, "deaf": False})
    assert revoked == [(9, 42)]


@pytest.mark.asyncio
async def test_server_removal_revokes_every_livekit_room(monkeypatch):
    calls: list[tuple[str, str]] = []

    class Pool:
        async def fetch(self, query, *args):
            return [{"id": 9}, {"id": 10}]

    class Hub:
        user_voice = {42: 9}

        async def send(self, users, event, data):
            calls.append((event, data["channel_id"]))

        async def set_voice(self, user_id, channel_id, state):
            calls.append(("set_voice", str(user_id)))

    async def livekit(method, room, body):
        calls.append((method, room))

    monkeypatch.setattr(voz, "pool", lambda: Pool())
    monkeypatch.setattr(voz, "hub", Hub())
    monkeypatch.setattr(voz, "livekit", livekit)

    await voz.revoke_server_voice(5, 42)

    assert ("RemoveParticipant", "cdg-9") in calls
    assert ("RemoveParticipant", "cdg-10") in calls
    assert ("set_voice", "42") in calls


async def async_value(value):
    return value
