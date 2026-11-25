"""Duração real de um áudio curto (recado de voz), lida do próprio arquivo, sem programa de fora.

Cobre o que os navegadores gravam com o MediaRecorder:
- WebM/Matroska (Chrome, Edge, Firefox, Android): soma o tempo dos blocos (o MediaRecorder não grava
  a duração no cabeçalho, então o jeito confiável é ver o tempo do último bloco).
- MP4/M4A (Safari), inclusive fragmentado: mvhd/mehd ou a soma das amostras dos fragmentos.
- Ogg/Opus: posição do último pedaço.

Devolve None quando não dá para ter certeza: quem chama deve recusar o arquivo.

Isto é só a primeira peneira (rápida, sem decodificar). A palavra final é de `decoded_seconds`, que
decodifica o áudio de verdade com o FFmpeg (PyAV) e soma as amostras que saíram.
"""

from __future__ import annotations

import io
import struct

MAX_STEPS = 200_000  # o arquivo é pequeno (até 1 MB); isto só evita laço sem fim em arquivo malformado


def audio_seconds(data: bytes) -> float | None:
    try:
        if data[:4] == b"\x1a\x45\xdf\xa3":
            return _webm(data)
        if data[4:8] == b"ftyp":
            return _mp4(data)
        if data[:4] == b"OggS":
            return _ogg(data)
    except (IndexError, ValueError, struct.error):
        return None
    return None


# ------------------------------------------------------------------ WebM / Matroska
_MASTERS = {0x18538067, 0x1F43B675, 0xA0, 0x1549A966}  # Segment, Cluster, BlockGroup, Info


def _vint(data: bytes, pos: int, keep_marker: bool) -> tuple[int, int, bool]:
    first = data[pos]
    if first == 0:
        raise ValueError("vint")
    length = 8 - first.bit_length() + 1
    value = first if keep_marker else first & ((1 << (8 - length)) - 1)
    unknown = not keep_marker and value == (1 << (8 - length)) - 1
    for b in data[pos + 1 : pos + length]:
        value = (value << 8) | b
        unknown = unknown and b == 0xFF
    if pos + length > len(data):
        raise ValueError("vint")
    return value, length, unknown


def _webm(data: bytes) -> float | None:
    pos, steps = 0, 0
    scale = 1_000_000  # ns por unidade de tempo (padrão do Matroska)
    cluster = 0
    last = -1
    header_duration = 0.0
    while pos < len(data):
        steps += 1
        if steps > MAX_STEPS:
            return None
        eid, n1, _ = _vint(data, pos, keep_marker=True)
        size, n2, unknown = _vint(data, pos + n1, keep_marker=False)
        body = pos + n1 + n2
        if eid in _MASTERS:
            pos = body  # entra: os filhos vêm logo em seguida (o tamanho pode ser "desconhecido")
            continue
        if unknown:
            return None
        end = body + size
        if end > len(data):
            break  # último elemento cortado: fica com o que deu para ler
        chunk = data[body:end]
        if eid == 0x2AD7B1 and chunk:  # TimecodeScale
            scale = int.from_bytes(chunk, "big") or scale
        elif eid == 0x4489 and len(chunk) in (4, 8):  # Duration (float, em unidades de tempo)
            header_duration = struct.unpack(">f" if len(chunk) == 4 else ">d", chunk)[0]
        elif eid == 0xE7:  # Timecode do cluster
            cluster = int.from_bytes(chunk, "big")
        elif eid in (0xA3, 0xA1) and len(chunk) >= 4:  # SimpleBlock / Block
            _, tn, _ = _vint(chunk, 0, keep_marker=False)
            rel = struct.unpack(">h", chunk[tn : tn + 2])[0]
            last = max(last, cluster + rel)
        pos = end
    if last < 0 and header_duration <= 0:
        return None
    units = max(float(last), header_duration)
    return units * scale / 1e9


# ------------------------------------------------------------------ MP4 / M4A
_CONTAINERS = {b"moov", b"trak", b"mdia", b"mvex", b"moof", b"traf"}


def _mp4(data: bytes) -> float | None:
    movie_scale = 0
    movie_duration = 0
    fragment_duration = 0
    track_scale = 0
    trex_default = 0
    tfhd_default = 0
    samples_total = 0
    stack = [(0, len(data))]
    steps = 0
    while stack:
        pos, end = stack.pop()
        while pos + 8 <= end:
            steps += 1
            if steps > MAX_STEPS:
                return None
            size, kind = struct.unpack(">I4s", data[pos : pos + 8])
            head = 8
            if size == 1:
                size = struct.unpack(">Q", data[pos + 8 : pos + 16])[0]
                head = 16
            elif size == 0:
                size = end - pos
            if size < head or pos + size > end:
                break
            body, box_end = pos + head, pos + size
            if kind in _CONTAINERS:
                stack.append((box_end, end))
                pos, end = body, box_end
                continue
            p = data[body:box_end]
            if kind in (b"mvhd", b"mdhd"):
                if p[0] == 1:
                    scale, duration = struct.unpack(">IQ", p[20:32])
                else:
                    scale, duration = struct.unpack(">II", p[12:20])
                if kind == b"mvhd":
                    movie_scale, movie_duration = scale, duration
                else:
                    track_scale = scale
            elif kind == b"mehd":
                fragment_duration = struct.unpack(">Q", p[4:12])[0] if p[0] == 1 else struct.unpack(">I", p[4:8])[0]
            elif kind == b"trex":
                trex_default = struct.unpack(">I", p[12:16])[0]
            elif kind == b"tfhd":
                flags = int.from_bytes(p[1:4], "big")
                off = 8 + (8 if flags & 0x1 else 0) + (4 if flags & 0x2 else 0)
                tfhd_default = struct.unpack(">I", p[off : off + 4])[0] if flags & 0x8 else 0
            elif kind == b"trun":
                flags = int.from_bytes(p[1:4], "big")
                count = struct.unpack(">I", p[4:8])[0]
                off = 8 + (4 if flags & 0x1 else 0) + (4 if flags & 0x4 else 0)
                per = sum(4 for bit in (0x100, 0x200, 0x400, 0x800) if flags & bit)
                if count > MAX_STEPS or off + count * per > len(p):
                    return None
                default = tfhd_default or trex_default
                for i in range(count):
                    if flags & 0x100:
                        samples_total += struct.unpack(">I", p[off + i * per : off + i * per + 4])[0]
                    else:
                        samples_total += default
            pos = box_end
    seconds = 0.0
    if movie_scale:
        seconds = max(movie_duration, fragment_duration) / movie_scale
    if track_scale and samples_total:
        seconds = max(seconds, samples_total / track_scale)
    return seconds if seconds > 0 else None


# ------------------------------------------------------------------ Ogg (Opus)
def _ogg(data: bytes) -> float | None:
    if b"OpusHead" not in data[:200]:
        return None  # só Opus (48 kHz fixo); Vorbis e outros ficam de fora
    last = data.rfind(b"OggS")
    if last < 0 or last + 14 > len(data):
        return None
    granule = struct.unpack("<q", data[last + 6 : last + 14])[0]
    return granule / 48000 if granule > 0 else None


# ------------------------------------------------------------------ decodificação de verdade
# só o que o MediaRecorder dos navegadores grava (nomes como o FFmpeg chama)
DECODE_FORMATS = {"matroska,webm", "mov,mp4,m4a,3gp,3g2,mj2", "ogg"}
DECODE_CODECS = {"opus", "aac", "vorbis"}


def decoded_seconds(data: bytes, stop_after: float = 60.0) -> float | None:
    """Duração das amostras que o FFmpeg conseguiu decodificar, ou None se o áudio não decodifica.

    Recusa: formato/codec fora do que o app grava, mais de uma faixa de áudio, vídeo junto, erro de
    decodificação no meio do arquivo e áudio sem nenhuma amostra. Para de decodificar ao passar de
    `stop_after` segundos (quem chama já recusa antes disso).
    """
    import av  # noqa: PLC0415

    try:
        with av.open(io.BytesIO(data), mode="r") as box:
            if box.format.name not in DECODE_FORMATS:
                return None
            audio = [s for s in box.streams if s.type == "audio"]
            if len(audio) != 1 or len(box.streams) != 1:
                return None
            stream = audio[0]
            if stream.codec_context.name not in DECODE_CODECS:
                return None
            samples = 0
            rate = 0
            for frame in box.decode(stream):
                if not frame.sample_rate:
                    return None
                rate = frame.sample_rate
                samples += frame.samples
                if samples / rate > stop_after:
                    break
    except Exception:  # noqa: BLE001 (qualquer erro do FFmpeg = arquivo recusado)
        return None
    if not rate or samples <= 0:
        return None
    return samples / rate

