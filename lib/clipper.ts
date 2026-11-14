"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Track } from "livekit-client";

/* ------------------------------------------------------------------ */
/* Clipar momento: guarda sempre os últimos ~40 s da tela compartilhada */
/* (com o som da tela e as vozes da call) para salvar depois do lance.   */
/*                                                                      */
/* Um arquivo de vídeo só pode começar num ponto de cabeçalho, então     */
/* rodam dois gravadores defasados em meia janela: na hora de clipar,    */
/* o mais antigo tem entre 20 e 40 s e vira o clipe.                     */
/* ------------------------------------------------------------------ */

const WINDOW_MS = 40_000;
const BITRATE = 4_000_000;

function pickMime(): { mime: string; ext: "mp4" | "webm" } | null {
  if (typeof MediaRecorder === "undefined") return null;
  const options: [string, "mp4" | "webm"][] = [
    ["video/mp4;codecs=avc1.640028,mp4a.40.2", "mp4"],
    ["video/mp4;codecs=avc1,mp4a.40.2", "mp4"],
    ["video/mp4", "mp4"],
    ["video/webm;codecs=vp9,opus", "webm"],
    ["video/webm;codecs=vp8,opus", "webm"],
    ["video/webm", "webm"],
  ];
  for (const [mime, ext] of options) if (MediaRecorder.isTypeSupported(mime)) return { mime, ext };
  return null;
}

interface Slot {
  rec: MediaRecorder | null;
  chunks: Blob[];
  startedAt: number;
  timer: number;
  /** quando alguém pediu o clipe, o próximo onstop entrega o vídeo aqui */
  take: ((b: Blob | null) => void) | null;
}

export interface ClipResult {
  blob: Blob;
  ext: "mp4" | "webm";
  seconds: number;
}

export function useClipper({ enabled, video, audio }: { enabled: boolean; video?: Track; audio: Track[] }) {
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const ctxRef = useRef<AudioContext | null>(null);
  const destRef = useRef<MediaStreamAudioDestinationNode | null>(null);
  const sourcesRef = useRef(new Map<string, MediaStreamAudioSourceNode>());
  const slotsRef = useRef<Slot[]>([]);
  const [format] = useState(pickMime);
  const streamRef = useRef<MediaStream | null>(null);

  const videoTrack = enabled ? video?.mediaStreamTrack : undefined;

  /* ---------------- mixer de áudio (tela + vozes) ---------------- */
  useEffect(() => {
    if (!videoTrack) return;
    const ctx = ctxRef.current ?? new AudioContext();
    ctxRef.current = ctx;
    destRef.current ??= ctx.createMediaStreamDestination();
    // um tom mudo mantém a trilha de áudio viva mesmo com todo mundo calado
    const keep = ctx.createConstantSource();
    const g = ctx.createGain();
    g.gain.value = 0;
    keep.connect(g).connect(destRef.current);
    keep.start();
    return () => {
      keep.stop();
      keep.disconnect();
    };
  }, [videoTrack]);

  const audioKey = audio.map((t) => t.mediaStreamTrack?.id).join(",");
  useEffect(() => {
    const ctx = ctxRef.current;
    const dest = destRef.current;
    if (!videoTrack || !ctx || !dest) return;
    const want = new Map(audio.filter((t) => t.mediaStreamTrack).map((t) => [t.mediaStreamTrack.id, t.mediaStreamTrack]));
    for (const [id, node] of sourcesRef.current) {
      if (!want.has(id)) {
        node.disconnect();
        sourcesRef.current.delete(id);
      }
    }
    for (const [id, track] of want) {
      if (sourcesRef.current.has(id)) continue;
      try {
        const node = ctx.createMediaStreamSource(new MediaStream([track]));
        node.connect(dest);
        sourcesRef.current.set(id, node);
      } catch {
        /* trilha sem áudio de verdade */
      }
    }
    if (ctx.state === "suspended") void ctx.resume().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audioKey, videoTrack]);

  /* ---------------- gravadores defasados ---------------- */
  useEffect(() => {
    const fmt = format;
    const dest = destRef.current;
    if (!videoTrack || !fmt || !dest) {
      setReady(false);
      return;
    }
    const stream = new MediaStream([videoTrack, ...dest.stream.getAudioTracks()]);
    streamRef.current = stream;
    let alive = true;

    const start = (slot: Slot) => {
      if (!alive) return;
      let rec: MediaRecorder;
      try {
        rec = new MediaRecorder(stream, { mimeType: fmt.mime, videoBitsPerSecond: BITRATE, audioBitsPerSecond: 128_000 });
      } catch {
        setReady(false);
        return;
      }
      slot.rec = rec;
      slot.chunks = [];
      slot.startedAt = Date.now();
      rec.ondataavailable = (e) => e.data.size && slot.chunks.push(e.data);
      rec.onstop = () => {
        const take = slot.take;
        slot.take = null;
        if (take) take(slot.chunks.length ? new Blob(slot.chunks, { type: fmt.mime.split(";")[0] }) : null);
        slot.chunks = [];
        start(slot); // recomeça na hora
      };
      rec.start(1000);
      window.clearTimeout(slot.timer);
      slot.timer = window.setTimeout(() => slot.rec?.state === "recording" && slot.rec.stop(), WINDOW_MS);
    };

    const slots: Slot[] = [0, 1].map(() => ({ rec: null, chunks: [], startedAt: 0, timer: 0, take: null }));
    slotsRef.current = slots;
    start(slots[0]);
    const offset = window.setTimeout(() => start(slots[1]), WINDOW_MS / 2);
    setReady(true);

    return () => {
      alive = false;
      window.clearTimeout(offset);
      for (const s of slots) {
        window.clearTimeout(s.timer);
        s.take?.(null);
        s.take = null;
        if (s.rec && s.rec.state !== "inactive") {
          s.rec.onstop = null;
          s.rec.stop();
        }
      }
      slotsRef.current = [];
      setReady(false);
    };
  }, [videoTrack, format]);

  // sai da call / desliga: fecha o mixer
  useEffect(() => {
    if (enabled) return;
    for (const n of sourcesRef.current.values()) n.disconnect();
    sourcesRef.current.clear();
    void ctxRef.current?.close().catch(() => {});
    ctxRef.current = null;
    destRef.current = null;
  }, [enabled]);

  const clip = useCallback(async (): Promise<ClipResult | null> => {
    const fmt = format;
    const slot = slotsRef.current.filter((s) => s.rec?.state === "recording").sort((a, b) => a.startedAt - b.startedAt)[0];
    if (!slot || !fmt || slot.take) return null;
    setBusy(true);
    const seconds = Math.round((Date.now() - slot.startedAt) / 1000);
    const blob = await new Promise<Blob | null>((resolve) => {
      slot.take = resolve;
      window.clearTimeout(slot.timer);
      slot.rec!.stop();
    });
    setBusy(false);
    return blob && blob.size > 0 ? { blob, ext: fmt.ext, seconds } : null;
  }, [format]);

  return { supported: !!format, ready, busy, clip };
}
