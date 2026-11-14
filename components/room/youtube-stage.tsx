"use client";

import { useEffect, useRef, useState } from "react";
import { Pause, Play } from "lucide-react";
import { YT_STATE, expectedTime, type YTPlayer, type YouTubeSync } from "@/lib/use-youtube-sync";
import { loadJSON, saveJSON } from "@/lib/prefs";
import { useTicker } from "./media";

/* ---------------- carregamento único da IFrame API ---------------- */

type YTNamespace = {
  Player: new (
    el: HTMLElement,
    opts: {
      videoId?: string;
      width?: string;
      height?: string;
      playerVars?: Record<string, string | number>;
      events?: {
        onReady?: (e: { target: YTPlayer }) => void;
        onStateChange?: (e: { data: number; target: YTPlayer }) => void;
        onError?: (e: { data: number }) => void;
      };
    },
  ) => YTPlayer;
};

let apiPromise: Promise<YTNamespace> | null = null;
function loadApi(): Promise<YTNamespace> {
  const w = window as unknown as { YT?: YTNamespace; onYouTubeIframeAPIReady?: () => void };
  if (w.YT?.Player) return Promise.resolve(w.YT);
  if (apiPromise) return apiPromise;
  apiPromise = new Promise((resolve, reject) => {
    const prev = w.onYouTubeIframeAPIReady;
    w.onYouTubeIframeAPIReady = () => {
      prev?.();
      resolve(w.YT!);
    };
    const s = document.createElement("script");
    s.src = "https://www.youtube.com/iframe_api";
    s.async = true;
    s.onerror = () => {
      apiPromise = null;
      reject(new Error("YouTube indisponível"));
    };
    document.head.appendChild(s);
  });
  return apiPromise;
}

const fmt = (t: number) => {
  if (!Number.isFinite(t) || t < 0) t = 0;
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = Math.floor(t % 60);
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
};

const ERRORS: Record<number, string> = {
  2: "Link de vídeo inválido.",
  5: "Este vídeo não toca no player embutido.",
  100: "Vídeo não encontrado ou privado.",
  101: "O dono do vídeo não permite tocar fora do YouTube.",
  150: "O dono do vídeo não permite tocar fora do YouTube.",
};

export function YouTubeStage({ yt }: { yt: YouTubeSync }) {
  const box = useRef<HTMLDivElement>(null);
  const mount = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const [err, setErr] = useState("");
  const [full, setFull] = useState(false);
  const [vol, setVol] = useState(() => loadJSON("share", { ytVolume: 80 }).ytVolume as number);
  const [scrub, setScrub] = useState<number | null>(null);
  const state = yt.state;
  useTicker(500, !!state?.playing);

  const { registerPlayer, onPlayerState } = yt;
  const firstVideo = useRef(state?.videoId);

  useEffect(() => {
    let player: YTPlayer | null = null;
    let cancelled = false;
    const host = document.createElement("div");
    mount.current?.appendChild(host);
    loadApi()
      .then((YT) => {
        if (cancelled) return;
        player = new YT.Player(host, {
          videoId: firstVideo.current,
          width: "100%",
          height: "100%",
          playerVars: {
            controls: 0,
            disablekb: 1,
            rel: 0,
            playsinline: 1,
            iv_load_policy: 3,
            fs: 0,
            hl: "pt-BR",
            cc_lang_pref: "pt",
            origin: window.location.origin,
          },
          events: {
            onReady: (e) => {
              if (cancelled) return;
              e.target.setVolume(vol);
              setReady(true);
              registerPlayer(e.target);
            },
            onStateChange: (e) => {
              if (e.data === YT_STATE.PLAYING) setErr("");
              onPlayerState(e.data);
            },
            onError: (e) => setErr(ERRORS[e.data] ?? "O YouTube não conseguiu tocar este vídeo."),
          },
        });
      })
      .catch(() => setErr("Não foi possível carregar o YouTube."));
    return () => {
      cancelled = true;
      registerPlayer(null);
      try {
        player?.destroy();
      } catch {
        /* iframe já removido */
      }
      host.remove();
    };
    // o player é criado uma vez; trocas de vídeo passam por applyToPlayer
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [registerPlayer, onPlayerState]);

  useEffect(() => {
    const p = yt.playerRef.current;
    if (!p || !ready) return;
    p.setVolume(vol);
    if (vol === 0) p.mute();
    else p.unMute();
    saveJSON("share", { ...loadJSON("share", {}), ytVolume: vol });
  }, [vol, ready, yt.playerRef]);

  useEffect(() => {
    const onFs = () => setFull(document.fullscreenElement === box.current);
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);

  if (!state) return null;
  const p = yt.playerRef.current;
  const rawDuration = ready ? p?.getDuration() : 0;
  const duration = rawDuration && Number.isFinite(rawDuration) ? rawDuration : 0;
  const rawNow = scrub ?? (ready && p ? p.getCurrentTime() : expectedTime(state));
  const now = Number.isFinite(rawNow) ? rawNow : 0;
  const pct = duration ? Math.min(100, (now / duration) * 100) : 0;
  const title = (ready && p?.getVideoData?.()?.title) || "";

  const fullscreen = () => (document.fullscreenElement ? document.exitFullscreen() : box.current?.requestFullscreen());

  return (
    <div ref={box} className="flex size-full flex-col bg-ink text-paper">
      <div className="relative min-h-0 flex-1 bg-black">
        <div ref={mount} className="absolute inset-0 [&_iframe]:size-full" />
        {/* camada que recebe o clique, para ninguém mexer no player sem sincronizar */}
        <button
          type="button"
          aria-label={state.playing ? "Pausar para todos" : "Dar play para todos"}
          className="absolute inset-0 cursor-pointer"
          onClick={() => (state.playing ? yt.pause() : yt.play())}
          onDoubleClick={fullscreen}
        />
        {err && (
          <p className="pointer-events-none absolute left-0 top-0 max-w-md border-l-4 border-signal bg-paper px-4 py-3 text-[13px] text-ink">
            {err}
          </p>
        )}
      </div>

      {/* barra de controle: estrutura, não sobreposição */}
      <input
        type="range"
        className="range -mt-[7px] w-full text-paper"
        min={0}
        max={duration || 1}
        step={0.5}
        value={Math.min(now, duration || 1)}
        disabled={!duration}
        onChange={(e) => setScrub(Number(e.target.value))}
        onPointerUp={() => {
          if (scrub !== null) yt.seek(scrub);
          setScrub(null);
        }}
        onKeyUp={() => {
          if (scrub !== null) yt.seek(scrub);
          setScrub(null);
        }}
        style={{ ["--fill" as string]: `${pct}%` }}
        aria-label="Posição do vídeo"
      />
      <div className="flex h-10 shrink-0 items-center gap-4">
        <button
          type="button"
          onClick={() => (state.playing ? yt.pause() : yt.play())}
          className="press grid size-8 shrink-0 place-items-center bg-paper text-ink hover:bg-signal"
          aria-label={state.playing ? "Pausar para todos" : "Dar play para todos"}
        >
          {state.playing ? <Pause className="size-3.5" fill="currentColor" /> : <Play className="size-3.5 translate-x-px" fill="currentColor" />}
        </button>
        <span className="label shrink-0 tabular-nums" data-yt-time>
          {fmt(now)} / {fmt(duration)}
        </span>
        <span className="label hidden min-w-0 truncate text-paper/50 md:block">
          {title || "YouTube"} — posto por {state.byName}
        </span>
        <span className="ml-auto flex shrink-0 items-center gap-4">
          <label className="hidden items-center gap-2 sm:flex">
            <button type="button" onClick={() => setVol(vol > 0 ? 0 : 80)} className="label link-u" aria-label={vol > 0 ? "Silenciar" : "Ativar som"}>
              {vol > 0 ? "Som" : "Mudo"}
            </button>
            <input
              type="range"
              className="range w-20"
              min={0}
              max={100}
              value={vol}
              onChange={(e) => setVol(Number(e.target.value))}
              style={{ ["--fill" as string]: `${vol}%` }}
              aria-label="Volume do vídeo (só para você)"
            />
          </label>
          <button type="button" onClick={yt.resync} className="label link-u" title="Ressincronizar com a turma">
            Sincronizar
          </button>
          <button type="button" onClick={fullscreen} className="label link-u" aria-label={full ? "Sair da tela cheia" : "Tela cheia"}>
            {full ? "Sair ⤡" : "Tela cheia ⤢"}
          </button>
          <button type="button" onClick={yt.stop} className="label link-u text-signal" title="Fechar o vídeo para todos">
            Fechar ×
          </button>
        </span>
      </div>
    </div>
  );
}
