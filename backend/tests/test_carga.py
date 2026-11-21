"""Limite da tela pela carga do servidor: até 50% libera 4K, até 75% 1080p, acima disso 720p."""

from __future__ import annotations

import pytest

from app import carga


def test_thresholds():
    assert carga.resolution_for(None) == "2160p"
    assert carga.resolution_for(0) == "2160p"
    assert carga.resolution_for(49.9) == "2160p"
    assert carga.resolution_for(50) == "1080p"
    assert carga.resolution_for(74.9) == "1080p"
    assert carga.resolution_for(75) == "720p"
    assert carga.resolution_for(100) == "720p"


@pytest.fixture
def proc(tmp_path, monkeypatch):
    """Um /proc de mentira que o teste vai mexendo."""
    (tmp_path / "net").mkdir()
    monkeypatch.setattr(carga, "_PROC", tmp_path)
    monkeypatch.setattr(carga, "_last", {"at": 0.0, "cpu": None, "net": None, "usage": None})
    monkeypatch.setattr(carga.settings, "livekit_url", "wss://voz-call.exemplo.com")
    monkeypatch.setattr(carga.os, "getloadavg", lambda: (0.4, 0, 0), raising=False)
    monkeypatch.setattr(carga.os, "cpu_count", lambda: 4)
    clock = {"t": 100.0}
    monkeypatch.setattr(carga.time, "monotonic", lambda: clock["t"])

    def set_state(busy: int, idle: int, tx: int = 0):
        (tmp_path / "stat").write_text(f"cpu  {busy} 0 0 {idle} 0 0 0 0 0 0\ncpu0 1 1 1 1\n")
        (tmp_path / "net" / "dev").write_text(
            "Inter-|   Receive\n face |bytes\n"
            f"    lo: 0 0 0 0 0 0 0 0 999999999 0 0 0 0 0 0 0\n"
            f"  eth0: 0 0 0 0 0 0 0 0 {tx} 0 0 0 0 0 0 0\n"
        )

    def tick(seconds: float):
        clock["t"] += seconds

    return set_state, tick


def test_cpu_usage_picks_the_limit(proc):
    set_state, tick = proc
    set_state(1000, 9000)
    first = carga.current()
    assert first == {"usage": 10.0, "max_resolution": "2160p"}, "primeira leitura: carga média (0,4 em 4 núcleos)"
    tick(5)
    set_state(1000 + 60, 9000 + 40)  # 60% ocupado no intervalo
    assert carga.current() == {"usage": 60.0, "max_resolution": "1080p"}
    tick(1)
    set_state(1000 + 60 + 900, 9000 + 40 + 100)
    assert carga.current()["usage"] == 60.0, "menos de 3 s: usa a última leitura"
    tick(5)
    assert carga.current() == {"usage": 90.0, "max_resolution": "720p"}


def test_upload_bandwidth_counts_when_configured(proc, monkeypatch):
    set_state, tick = proc
    monkeypatch.setenv("UPLINK_MBPS", "100")
    set_state(0, 1000, tx=0)
    carga.current()
    tick(10)
    # CPU parada, mas mandou 100 MB em 10 s = 80 Mbps de 100 → 80%
    set_state(0, 2000, tx=100_000_000)
    assert carga.current() == {"usage": 80.0, "max_resolution": "720p"}


def test_cloud_never_limits(monkeypatch):
    monkeypatch.setattr(carga.settings, "livekit_url", "wss://projeto.livekit.cloud")
    assert carga.current() == {"usage": None, "max_resolution": "2160p"}
