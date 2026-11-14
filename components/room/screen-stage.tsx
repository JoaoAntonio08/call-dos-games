"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Peer } from "@/lib/use-call";
import { TrackVideo } from "./media";

function labelFor(h: number) {
  if (h >= 2000) return "4K";
  if (h >= 1400) return "1440p";
  if (h >= 1000) return "1080p";
  if (h >= 700) return "720p";
  return `${h}p`;
}

/** Tela compartilhada no palco. A legenda fica fora da imagem, como numa revista. */
export function ScreenStage({
  peer,
  volume,
  onVolume,
}: {
  peer: Peer;
  volume: number;
  onVolume: (v: number) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<[number, number]>([0, 0]);
  const [full, setFull] = useState(false);
  const onSize = useCallback((w: number, h: number) => setSize([w, h]), []);

  useEffect(() => {
    const onFs = () => setFull(document.fullscreenElement === box.current);
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);

  const toggleFull = () => (document.fullscreenElement ? document.exitFullscreen() : box.current?.requestFullscreen());

  if (!peer.screen) return null;
  return (
    <div className="flex size-full flex-col">
      <div ref={box} className="relative min-h-0 flex-1 bg-black" onDoubleClick={toggleFull}>
        <TrackVideo track={peer.screen} fit="contain" className="absolute inset-0 size-full" onSize={onSize} />
      </div>
      <div className="flex h-10 shrink-0 items-center gap-4 border-t border-paper/15 text-paper">
        <span className="label truncate">{peer.isLocal ? "Sua tela — prévia" : `Tela de ${peer.name}`}</span>
        {size[1] > 0 && (
          <span className="label tabular-nums text-paper/50">
            {labelFor(size[1])} · {size[0]}×{size[1]}
          </span>
        )}
        <span className="ml-auto flex items-center gap-4">
          {!peer.isLocal && peer.screenAudio && (
            <label className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => onVolume(volume > 0 ? 0 : 1)}
                className="label link-u"
                aria-label={volume > 0 ? "Silenciar a tela" : "Ativar som da tela"}
              >
                {volume > 0 ? "Som" : "Mudo"}
              </button>
              <input
                type="range"
                className="range w-24"
                min={0}
                max={1}
                step={0.02}
                value={volume}
                onChange={(e) => onVolume(Number(e.target.value))}
                style={{ ["--fill" as string]: `${volume * 100}%` }}
                aria-label="Volume da tela"
              />
            </label>
          )}
          <button type="button" onClick={toggleFull} className="label link-u" aria-label={full ? "Sair da tela cheia" : "Tela cheia"}>
            {full ? "Sair ⤡" : "Tela cheia ⤢"}
          </button>
        </span>
      </div>
    </div>
  );
}
