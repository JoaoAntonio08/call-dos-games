"use client";

import { useEffect, useRef, useState } from "react";
import type { Track } from "livekit-client";

/** Mostra uma trilha de vídeo do LiveKit. `onSize` informa a resolução que está chegando. */
export function TrackVideo({
  track,
  mirror,
  fit = "cover",
  className = "",
  onSize,
}: {
  track: Track;
  mirror?: boolean;
  fit?: "cover" | "contain";
  className?: string;
  onSize?: (w: number, h: number) => void;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    track.attach(el);
    const report = () => onSize?.(el.videoWidth, el.videoHeight);
    el.addEventListener("resize", report);
    el.addEventListener("loadedmetadata", report);
    return () => {
      el.removeEventListener("resize", report);
      el.removeEventListener("loadedmetadata", report);
      track.detach(el);
    };
  }, [track, onSize]);
  return (
    <video
      ref={ref}
      autoPlay
      playsInline
      muted
      className={className}
      style={{ objectFit: fit, transform: mirror ? "scaleX(-1)" : undefined }}
    />
  );
}

/** Toca uma trilha de áudio remota com volume próprio (0 a 1). */
export function TrackAudio({ track, volume }: { track: Track; volume: number }) {
  const ref = useRef<HTMLAudioElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    track.attach(el);
    return () => {
      track.detach(el);
    };
  }, [track]);
  useEffect(() => {
    if (ref.current) ref.current.volume = Math.max(0, Math.min(1, volume));
  }, [volume, track]);
  return <audio ref={ref} autoPlay />;
}

/** Cor estável por nome, para o avatar de quem está sem câmera. */
export function hueOf(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;
  return h;
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  return (parts[0][0] + (parts[1]?.[0] ?? "")).toUpperCase();
}

/** Atualiza um valor de tempo em intervalo (para relógios e barras de progresso). */
export function useTicker(ms: number, enabled = true) {
  const [, setN] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    const id = window.setInterval(() => setN((n) => n + 1), ms);
    return () => window.clearInterval(id);
  }, [ms, enabled]);
}
