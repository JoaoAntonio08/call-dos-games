"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import Link from "next/link";
import { create } from "zustand";
import { Maximize2 } from "lucide-react";
import { useStore } from "@/lib/store";
import { useVoice } from "@/lib/voice";
import { YouTubeStage } from "@/components/room/youtube-stage";

/* ------------------------------------------------------------------ */
/* Player do YouTube que não para quando você troca de canal            */
/*                                                                      */
/* O iframe fica num lugar fixo da página (nunca sai do DOM, então não  */
/* recarrega). Na tela da call ele se encaixa no espaço do palco; fora  */
/* dela vira um mini player no canto, e a música continua.              */
/* ------------------------------------------------------------------ */

interface Slot {
  /** o espaço do palco onde o vídeo aparece (quando a aba YouTube está à mostra) */
  slot: HTMLElement | null;
  /** quantas telas da call estão abertas (com a aba Pessoas, o vídeo fica escondido mas tocando) */
  views: number;
}
const useSlot = create<Slot>(() => ({ slot: null, views: 0 }));

/** Marca que a tela da call está aberta (o vídeo some do canto e fica no palco). */
export function useCallViewMounted() {
  useEffect(() => {
    useSlot.setState((s) => ({ views: s.views + 1 }));
    return () => useSlot.setState((s) => ({ views: Math.max(0, s.views - 1) }));
  }, []);
}

/** O espaço reservado no palco da call para o vídeo. */
export function YtSlot({ className }: { className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    useSlot.setState({ slot: el });
    return () => useSlot.setState((s) => (s.slot === el ? { slot: null } : s));
  }, []);
  return <div ref={ref} className={className} />;
}

type Box = { left: number; top: number; width: number; height: number };

export function PersistentPlayer() {
  const v = useVoice();
  const yt = v.yt;
  const slot = useSlot((s) => s.slot);
  const views = useSlot((s) => s.views);
  const [box, setBox] = useState<Box | null>(null);
  const music = useStore((s) => (v.channelId ? s.music[v.channelId] : undefined));
  const href = useStore((s) => {
    const cid = v.channelId;
    if (!cid) return "/app";
    const srv = Object.values(s.servers).find((x) => x.channels.some((c) => c.id === cid));
    return srv ? `/app/s/${srv.id}/${cid}` : `/app/dm/${cid}`;
  });

  // acompanha o espaço do palco (muda com o chat aberto, a janela, a barra de membros…)
  useEffect(() => {
    if (!slot) return; // sem palco: o modo abaixo já ignora a última medida
    let raf = 0;
    let last = "";
    const tick = () => {
      const r = slot.getBoundingClientRect();
      const key = `${r.left}|${r.top}|${r.width}|${r.height}`;
      if (key !== last) {
        last = key;
        setBox({ left: r.left, top: r.top, width: r.width, height: r.height });
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [slot]);

  if (!yt.state || !v.channelId) return null;
  const mode = slot && box ? "stage" : views > 0 ? "hidden" : "mini";
  const style: React.CSSProperties =
    mode === "stage"
      ? { position: "fixed", left: box!.left, top: box!.top, width: box!.width, height: box!.height, zIndex: 15 }
      : mode === "hidden"
        ? { position: "fixed", left: -10000, top: 0, width: 480, height: 270, pointerEvents: "none" }
        : { position: "fixed", right: 16, bottom: 16, width: 340, height: 191 + 44, zIndex: 40 };

  return (
    <div style={style} aria-hidden={mode === "hidden"} className={mode === "mini" ? "pop-in flex flex-col overflow-hidden rounded-[14px] bg-cocoa-0 shadow-[0_12px_40px_rgb(0_0_0/0.5)]" : ""}>
      <div className={mode === "mini" ? "relative min-h-0 flex-1" : "relative h-full w-full overflow-hidden rounded-[16px]"}>
        <YouTubeStage yt={yt} />
      </div>
      {mode === "mini" && (
        <div className="flex h-11 shrink-0 items-center gap-2 px-3">
          <span className={`eq-bars ${yt.state.playing ? "" : "opacity-40"}`} aria-hidden>
            <i />
            <i />
            <i />
          </span>
          <p className="min-w-0 flex-1 truncate text-[12.5px]">
            <span className="font-semibold">{music?.title ?? "YouTube na call"}</span>
            {music && <span className="text-oat/45"> · {music.owner_name}</span>}
          </p>
          <Link href={href} className="press flex shrink-0 items-center gap-1 rounded-[8px] px-2 py-1 text-[12px] font-semibold text-ember-2 hover:bg-cocoa-4" title="Voltar para a call">
            <Maximize2 className="size-3.5" /> Call
          </Link>
        </div>
      )}
    </div>
  );
}
