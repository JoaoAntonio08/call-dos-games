"use client";

import { MicOff } from "lucide-react";
import type { Peer } from "@/lib/use-call";
import { TrackVideo, initials } from "./media";

export function PeerTile({
  peer,
  compact,
  volume,
  onVolume,
}: {
  peer: Peer;
  compact?: boolean;
  volume: number;
  onVolume: (v: number) => void;
}) {
  const talking = peer.speaking && peer.micOn;
  return (
    <div className="group relative isolate aspect-video w-full overflow-hidden bg-ink-2">
      {peer.camera ? (
        <TrackVideo track={peer.camera} mirror={peer.isLocal} className="absolute inset-0 size-full" />
      ) : (
        <div className="absolute inset-0 grid place-items-center">
          <span
            className={`font-display leading-none transition-colors duration-150 ${talking ? "text-signal" : "text-paper/70"} ${
              compact ? "text-[44px]" : "text-[clamp(56px,7vw,104px)]"
            }`}
          >
            {initials(peer.name)}
          </span>
        </div>
      )}

      {/* quem fala ganha uma moldura de sinal, sem brilho */}
      <span
        aria-hidden
        className={`pointer-events-none absolute inset-0 border-2 transition-colors duration-150 ${
          talking ? "border-signal" : "border-paper/10"
        }`}
      />

      <div className="absolute bottom-0 left-0 flex max-w-full items-center gap-2 bg-ink px-2.5 py-1.5">
        {!peer.micOn && <MicOff className="size-3 shrink-0 text-signal" aria-label="Microfone desligado" />}
        <span className="label truncate text-paper">
          {peer.name}
          {peer.isLocal && <span className="text-paper/45"> · você</span>}
        </span>
        {peer.screen && <span className="label text-signal">· tela</span>}
      </div>

      {!peer.isLocal && (
        <label
          className="absolute right-0 top-0 flex items-center gap-2 bg-ink px-2.5 py-1.5 text-paper opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100"
          title={`Volume de ${peer.name}`}
        >
          <span className="label tabular-nums text-paper/60">{Math.round(volume * 100)}</span>
          <input
            type="range"
            className="range w-20"
            min={0}
            max={1}
            step={0.05}
            value={volume}
            onChange={(e) => onVolume(Number(e.target.value))}
            style={{ ["--fill" as string]: `${volume * 100}%` }}
            aria-label={`Volume de ${peer.name}`}
          />
        </label>
      )}
    </div>
  );
}
