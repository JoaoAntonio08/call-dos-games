"""Quanto o servidor está aguentando, para limitar a qualidade da tela compartilhada.

Só vale com o LiveKit próprio (na mesma máquina): é ele que carrega o vídeo.
- uso abaixo de 50%: libera até 4K
- de 50% a 75%: no máximo 1080p
- 75% ou mais: só 720p

Uso = o maior entre a CPU e, se UPLINK_MBPS estiver no .env, a banda de envio usada.
No LiveKit Cloud (ou fora do Linux) não limita nada.
"""

from __future__ import annotations

import os
import time
from pathlib import Path

from .core import env, settings

STEPS = ((50.0, "2160p"), (75.0, "1080p"))
FLOOR = "720p"
SAMPLE_EVERY = 3.0  # segundos entre leituras (pedidos no meio usam a última)

_PROC = Path("/proc")
_last: dict = {"at": 0.0, "cpu": None, "net": None, "usage": None}


def resolution_for(usage: float | None) -> str:
    if usage is None:
        return "2160p"
    for limit, res in STEPS:
        if usage < limit:
            return res
    return FLOOR


def _cpu_times() -> tuple[int, int] | None:
    """(ocupado, total) somando todos os núcleos, de /proc/stat."""
    try:
        first = (_PROC / "stat").read_text().splitlines()[0].split()
    except (OSError, IndexError):
        return None
    if first[0] != "cpu":
        return None
    v = [int(x) for x in first[1:]]
    idle = v[3] + (v[4] if len(v) > 4 else 0)  # idle + iowait
    return sum(v) - idle, sum(v)


def _tx_bytes() -> int | None:
    """Bytes enviados por todas as placas de rede (menos a interna), de /proc/net/dev."""
    try:
        lines = (_PROC / "net" / "dev").read_text().splitlines()[2:]
    except OSError:
        return None
    total = 0
    for line in lines:
        name, _, rest = line.partition(":")
        if name.strip() == "lo":
            continue
        cols = rest.split()
        if len(cols) >= 9:
            total += int(cols[8])
    return total


def _sample(now: float) -> None:
    cpu, net = _cpu_times(), _tx_bytes()
    prev_cpu, prev_net, prev_at = _last["cpu"], _last["net"], _last["at"]
    parts: list[float] = []
    if cpu and prev_cpu and cpu[1] > prev_cpu[1]:
        parts.append(100.0 * (cpu[0] - prev_cpu[0]) / (cpu[1] - prev_cpu[1]))
    uplink = float(env("UPLINK_MBPS", "0") or 0)
    if uplink > 0 and net is not None and prev_net is not None and now > prev_at:
        mbps = (net - prev_net) * 8 / 1e6 / (now - prev_at)
        parts.append(100.0 * mbps / uplink)
    if not parts and _last["usage"] is None and hasattr(os, "getloadavg"):
        # primeira leitura (sem a anterior para comparar): a carga média do último minuto
        parts.append(100.0 * os.getloadavg()[0] / (os.cpu_count() or 1))
    _last.update(at=now, cpu=cpu, net=net, usage=(round(min(max(parts), 100.0), 1) if parts else _last["usage"]))


def self_hosted() -> bool:
    return bool(settings.livekit_url) and "livekit.cloud" not in settings.livekit_url


def current() -> dict:
    """{'usage': 0-100 ou None, 'max_resolution': '2160p' | '1080p' | '720p'}"""
    if not self_hosted():
        return {"usage": None, "max_resolution": "2160p"}
    now = time.monotonic()
    if now - _last["at"] >= SAMPLE_EVERY or _last["cpu"] is None:
        _sample(now)
    usage = _last["usage"]
    return {"usage": usage, "max_resolution": resolution_for(usage)}
