"""Conquistas: o servidor conta o tempo de call e de tela, e só deixa mostrar o enfeite liberado."""

from __future__ import annotations

from app import conquistas as cq


def test_call_alone_does_not_count():
    assert cq.credits({1: {10: {}}}, 60) == {}, "call com uma pessoa só não soma"


def test_call_share_and_watch_time():
    voice = {
        1: {10: {"stream": True}, 11: {}, 12: {"stream": False}},
        2: {20: {}, 21: {}},
    }
    c = cq.credits(voice, 60)
    assert c[10] == [60, 60, 0], "quem transmite soma call e transmissão, não assistindo a si mesmo"
    assert c[11] == [60, 0, 60] and c[12] == [60, 0, 60], "quem está na call de quem transmite soma assistindo"
    assert c[20] == [60, 0, 0], "call sem tela: só tempo de call"


def test_two_streamers_watch_each_other():
    c = cq.credits({1: {1: {"stream": True}, 2: {"stream": True}}}, 30)
    assert c[1] == [30, 30, 30] and c[2] == [30, 30, 30]


def test_unlocked_by_thresholds():
    got = cq.unlocked_from({"call": 10, "share": 0.9, "watch": 3, "servers": 1})
    assert got == ["ring:pulse", "name:gradient", "plate:crowd", "plate:founder"]
    assert cq.unlocked_from({}) == []


def test_flair_only_what_was_unlocked_and_in_the_right_slot():
    unlocked = ["ring:pulse", "name:gradient", "plate:founder"]
    assert cq.clean_flair({"name": "gradient", "plate": "founder", "ring": "pulse"}, unlocked) == {"name": "gradient", "plate": "founder", "ring": "pulse"}
    assert cq.clean_flair({"name": "rgb"}, unlocked) == {}, "RGB ainda não liberado"
    assert cq.clean_flair({"name": "founder"}, unlocked) == {}, "placa não vai no lugar do nome"
    assert cq.clean_flair({"plate": "", "banner": "shine", "x": "y"}, unlocked) == {}
    assert cq.clean_flair("lixo", unlocked) == {}


def test_parse_flair_from_db_text():
    assert cq.parse_flair('{"name": "rgb", "x": "y", "plate": ""}') == {"name": "rgb"}
    assert cq.parse_flair("não é json") == {}
    assert cq.parse_flair(None) == {}


def test_hours_are_not_rounded_up_before_unlocking(monkeypatch):
    import asyncio

    class FakePool:
        async def fetchrow(self, *_a):
            return {"call_seconds": 4 * 3600 + 58 * 60, "share_seconds": 0, "watch_seconds": 0}

        async def fetchval(self, *_a):
            return 0

    monkeypatch.setattr(cq, "pool", lambda: FakePool())
    values = asyncio.run(cq.values_of(1))
    assert values["call"] < 5
    assert "ring:pulse" not in cq.unlocked_from(values), "4h58 ainda não é 5 h"
