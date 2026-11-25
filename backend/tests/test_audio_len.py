"""Duração real do recado: lida do arquivo, não do que o app diz."""

from __future__ import annotations

import struct
from pathlib import Path

from app.audio_len import audio_seconds

FIXTURES = Path(__file__).parent / "fixtures"


def box(kind: bytes, payload: bytes) -> bytes:
    return struct.pack(">I4s", 8 + len(payload), kind) + payload


def full(version: int, flags: int, rest: bytes) -> bytes:
    return bytes([version]) + flags.to_bytes(3, "big") + rest


def test_real_webm_from_the_browser_recorder():
    # gravado com o MediaRecorder do Chrome (audio/webm;codecs=opus), 2 s pedidos, 1,86 s decodificados
    data = (FIXTURES / "recado-2s.webm").read_bytes()
    got = audio_seconds(data)
    assert got is not None and 1.5 < got < 2.2


def test_webm_cut_in_half_counts_only_what_is_there():
    data = (FIXTURES / "recado-2s.webm").read_bytes()
    got = audio_seconds(data[: len(data) // 2])
    assert got is not None and got < 1.5


def ebml(eid: bytes, payload: bytes, unknown: bool = False) -> bytes:
    if unknown:
        return eid + b"\x01\xff\xff\xff\xff\xff\xff\xff" + payload
    assert len(payload) < 0x7F
    return eid + bytes([0x80 | len(payload)]) + payload


def test_long_webm_is_measured_by_its_blocks():
    block = b"\x81" + struct.pack(">h", 500) + b"\x80" + b"\x00" * 4  # trilha 1, +500 ms
    cluster = ebml(b"\x1f\x43\xb6\x75", ebml(b"\xe7", (31_000).to_bytes(2, "big")) + ebml(b"\xa3", block), unknown=True)
    data = ebml(b"\x1a\x45\xdf\xa3", b"\x42\x86\x81\x01") + ebml(b"\x18\x53\x80\x67", cluster, unknown=True)
    assert audio_seconds(data) == 31.5


def test_mp4_with_movie_header():
    mvhd = box(b"mvhd", full(0, 0, struct.pack(">IIII", 0, 0, 1000, 12_345) + b"\x00" * 80))
    data = box(b"ftyp", b"M4A \x00\x00\x00\x00") + box(b"moov", mvhd)
    assert abs(audio_seconds(data) - 12.345) < 1e-9


def test_fragmented_mp4_sums_the_samples():
    # Safari grava MP4 fragmentado: o cabeçalho diz 0 e o tempo está nas amostras
    mvhd = box(b"mvhd", full(0, 0, struct.pack(">IIII", 0, 0, 1000, 0) + b"\x00" * 80))
    mdhd = box(b"mdhd", full(0, 0, struct.pack(">IIII", 0, 0, 48_000, 0) + b"\x00" * 4))
    trex = box(b"trex", full(0, 0, struct.pack(">IIIII", 1, 1, 1024, 0, 0)))
    moov = box(b"moov", box(b"trak", box(b"mdia", mdhd)) + box(b"mvex", trex))
    tfhd = box(b"tfhd", full(0, 0, struct.pack(">I", 1)))
    trun = box(b"trun", full(0, 0, struct.pack(">I", 1500)))  # 1500 amostras de 1024 (padrão do trex)
    moof = box(b"moof", box(b"traf", tfhd + trun))
    data = box(b"ftyp", b"iso5\x00\x00\x00\x00") + moov + moof
    assert abs(audio_seconds(data) - 1500 * 1024 / 48_000) < 1e-9  # 32 s: passa do limite


def test_ogg_opus_uses_the_last_page():
    head = b"OggS\x00\x02" + struct.pack("<q", 0) + b"\x00" * 14 + b"OpusHead"
    tail = b"OggS\x00\x04" + struct.pack("<q", 48_000 * 7) + b"\x00" * 14
    assert audio_seconds(head + b"\x00" * 50 + tail) == 7.0


def test_garbage_is_refused():
    assert audio_seconds(b"") is None
    assert audio_seconds(b"ID3\x04 nao e recado") is None
    assert audio_seconds(b"\x1a\x45\xdf\xa3\x00") is None
    assert audio_seconds(box(b"ftyp", b"M4A ") + struct.pack(">I4s", 9999, b"moov")) is None
