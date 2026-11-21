"""Ponte de voz: quem está na call do Discord, ligar pelo !ponte e o endpoint interno do ponte-voz."""

from __future__ import annotations

import asyncio
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.routes import discord as dc

GUILD = "900"
VOICE = "901"
TEXT = "902"
SECRET = "segredo-de-teste-comprido"


@pytest.fixture(autouse=True)
def clean(monkeypatch):
    fresh = dc._Ponte()
    monkeypatch.setattr(dc, "ponte", fresh)
    fresh.guilds[GUILD] = {
        "name": "Turma", "owner_id": "1", "roles": {GUILD: 0},
        "channels": {VOICE: "Jogatina", TEXT: "geral"}, "types": {VOICE: 2, TEXT: 0},
    }
    sent: list = []

    async def to_channel(cid, event, data):
        sent.append((cid, event, data))

    monkeypatch.setattr(dc.hub, "to_channel", to_channel)
    return fresh, sent


def vs(uid: str, channel: str | None, *, bot=False, mute=False, name="Zeca"):
    return {
        "guild_id": GUILD, "user_id": uid, "channel_id": channel, "self_mute": mute,
        "member": {"nick": name, "user": {"id": uid, "username": name.lower(), "bot": bot}},
    }


def link(channel_id=5):
    return {"channel_id": channel_id, "discord_channel_id": VOICE, "discord_guild_id": GUILD, "discord_name": "Jogatina", "guild_name": "Turma"}


def replies_to(monkeypatch) -> list[str]:
    got: list[str] = []

    async def reply(d, text):
        got.append(text)

    monkeypatch.setattr(dc, "_reply", reply)
    return got


def msg(channel: str) -> dict:
    return {"id": "1", "guild_id": GUILD, "channel_id": channel, "author": {"id": "1"}, "member": {"roles": []}}


@pytest.mark.asyncio
async def test_who_is_in_the_discord_call(clean):
    ponte, sent = clean
    ponte.vput(link())
    dc._dispatch("VOICE_STATE_UPDATE", vs("11", VOICE, name="Zeca"))
    dc._dispatch("VOICE_STATE_UPDATE", vs("12", VOICE, mute=True, name="Bia"))
    dc._dispatch("VOICE_STATE_UPDATE", vs("13", VOICE, bot=True, name="Musiquinha"))
    dc._dispatch("VOICE_STATE_UPDATE", vs("14", "999", name="Outra"))
    people = {p["name"]: p for p in ponte.in_call(link())}
    assert set(people) == {"Zeca", "Bia"}, "sem bots e sem quem está em outra call"
    assert people["Bia"]["mute"] is True
    dc._dispatch("VOICE_STATE_UPDATE", vs("11", None))  # saiu
    assert [p["name"] for p in ponte.in_call(link())] == ["Bia"]
    dc._dispatch("VOICE_STATE_UPDATE", vs("12", "999", name="Bia"))  # trocou de call
    assert ponte.in_call(link()) == []
    await asyncio.sleep(0)
    assert sent and sent[-1][:2] == (5, "discord_voice"), "avisa o app quando muda"
    assert sent[-1][2]["members"] == []


@pytest.mark.asyncio
async def test_guild_create_loads_who_is_already_in_call(clean):
    ponte, _ = clean
    ponte.vput(link())
    dc._dispatch("GUILD_CREATE", {
        "id": GUILD, "name": "Turma", "owner_id": "1", "roles": [],
        "channels": [{"id": VOICE, "name": "Jogatina", "type": 2}],
        "members": [{"nick": "Zeca", "user": {"id": "11", "username": "zeca"}}],
        "voice_states": [{"user_id": "11", "channel_id": VOICE}],
    })
    assert [p["name"] for p in ponte.in_call(link())] == ["Zeca"]
    assert dc.discord_voice_snapshot([5, 6]) == {"5": ponte.in_call(link())}


def test_guild_update_keeps_channel_types(clean):
    """GUILD_UPDATE não traz os canais: sem guardar os tipos, a call deixava de ser reconhecida como call."""
    dc._dispatch("GUILD_CREATE", {
        "id": GUILD, "name": "Turma", "owner_id": "1", "roles": [],
        "channels": [{"id": VOICE, "name": "Jogatina", "type": 2}, {"id": TEXT, "name": "geral", "type": 0}],
        "members": [], "voice_states": [],
    })
    dc._dispatch("GUILD_UPDATE", {"id": GUILD, "name": "Turma nova", "owner_id": "1", "roles": []})
    g = dc.ponte.guilds[GUILD]
    assert g["name"] == "Turma nova"
    assert g["channels"] == {VOICE: "Jogatina", TEXT: "geral"}
    assert g["types"] == {VOICE: 2, TEXT: 0}, "os tipos dos canais continuam lá"


@pytest.mark.asyncio
async def test_codes_go_to_the_right_kind_of_channel(clean, monkeypatch):
    ponte, _ = clean
    replies = replies_to(monkeypatch)
    ponte.codes["ABCD2345"] = (5, 42, 9e18, "voice")
    await dc._command(msg(TEXT), "ABCD-2345")
    assert "chat do canal de voz" in replies[-1]
    assert not ponte.vby_channel, "código de call não liga canal de texto"
    assert "ABCD2345" in ponte.codes, "o código continua valendo para tentar no lugar certo"
    ponte.codes["TEXT2345"] = (6, 42, 9e18, "text")
    await dc._command(msg(VOICE), "TEXT-2345")
    assert "canal de texto" in replies[-1]
    assert not ponte.by_channel


@pytest.mark.asyncio
async def test_voice_code_links_the_call(clean, monkeypatch):
    ponte, _ = clean
    replies = replies_to(monkeypatch)
    rows = {}

    async def fetchrow(q, *a):
        rows["args"] = a
        return {**link(a[0]), "created_by": a[5]}

    async def fetchval(q, *a):
        return "Jogatina"

    monkeypatch.setattr(dc, "pool", lambda: SimpleNamespace(fetchrow=fetchrow, fetchval=fetchval))
    ponte.codes["ABCD2345"] = (5, 42, 9e18, "voice")
    await dc._command(msg(VOICE), "abcd 2345")
    assert ponte.vby_channel[5]["discord_channel_id"] == VOICE
    assert rows["args"][:3] == (5, VOICE, GUILD)
    assert "ABCD2345" not in ponte.codes, "código só vale uma vez"
    assert replies[-1].startswith("Pronto!")


@pytest.mark.asyncio
async def test_only_discord_admins_link(clean, monkeypatch):
    ponte, _ = clean
    replies = replies_to(monkeypatch)
    ponte.codes["ABCD2345"] = (5, 42, 9e18, "voice")
    await dc._command({**msg(VOICE), "author": {"id": "77"}}, "ABCD2345")
    assert "administra" in replies[-1]
    assert not ponte.vby_channel


def _request(host: str):
    return SimpleNamespace(client=SimpleNamespace(host=host))


@pytest.mark.asyncio
async def test_internal_endpoint_needs_secret_and_local_machine(monkeypatch):
    monkeypatch.setattr(dc, "VOICE_SECRET", SECRET)
    for host, secret in [("127.0.0.1", "errado"), ("10.0.0.5", SECRET), ("127.0.0.1", "")]:
        with pytest.raises(HTTPException) as e:
            await dc.voice_bridge_state(_request(host), secret)
        assert e.value.status_code == 404
    monkeypatch.setattr(dc, "VOICE_SECRET", "")
    with pytest.raises(HTTPException):
        await dc.voice_bridge_state(_request("127.0.0.1"), "")


@pytest.mark.asyncio
async def test_internal_endpoint_says_when_both_sides_have_people(clean, monkeypatch):
    ponte, _ = clean
    monkeypatch.setattr(dc, "VOICE_SECRET", SECRET)
    monkeypatch.setattr(dc.hub, "voice", {})
    ponte.vput(link())
    out = await dc.voice_bridge_state(_request("127.0.0.1"), SECRET)
    assert out["links"][0]["active"] is False
    dc._dispatch("VOICE_STATE_UPDATE", vs("11", VOICE))
    out = await dc.voice_bridge_state(_request("127.0.0.1"), SECRET)
    assert out["links"][0]["active"] is False, "só o Discord tem gente"
    monkeypatch.setattr(dc.hub, "voice", {5: {42: {"mic": True}}})
    out = await dc.voice_bridge_state(_request("::1"), SECRET)
    assert out["links"][0] == {
        "channel_id": "5", "room": "cdg-5", "guild_id": GUILD, "discord_channel_id": VOICE,
        "app_people": 1, "discord_people": 1, "active": True,
    }
    # quem está surdo aqui não conta (não adianta ligar a ponte só para ele)
    monkeypatch.setattr(dc.hub, "voice", {5: {42: {"sdeaf": True}}})
    out = await dc.voice_bridge_state(_request("127.0.0.1"), SECRET)
    assert out["links"][0]["active"] is False
