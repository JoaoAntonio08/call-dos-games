"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { RoomEvent, type RemoteParticipant, type Room } from "livekit-client";

/* ------------------------------------------------------------------ */
/* Tipos mínimos da IFrame API do YouTube                               */
/* ------------------------------------------------------------------ */

export interface YTPlayer {
  playVideo(): void;
  pauseVideo(): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  loadVideoById(videoId: string, startSeconds?: number): void;
  cueVideoById(videoId: string, startSeconds?: number): void;
  getCurrentTime(): number;
  getDuration(): number;
  getPlayerState(): number;
  getVideoData?(): { video_id?: string; title?: string };
  setVolume(v: number): void;
  mute(): void;
  unMute(): void;
  destroy(): void;
}

export const YT_STATE = { UNSTARTED: -1, ENDED: 0, PLAYING: 1, PAUSED: 2, BUFFERING: 3, CUED: 5 } as const;

/** Extrai o id de 11 caracteres de qualquer link do YouTube (watch, youtu.be, shorts, live, embed). */
export function parseYouTube(input: string): { id: string; start: number } | null {
  const s = input.trim();
  if (/^[\w-]{11}$/.test(s)) return { id: s, start: 0 };
  let url: URL;
  try {
    url = new URL(s.startsWith("http") ? s : `https://${s}`);
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^www\.|^m\.|^music\./, "");
  let id = "";
  if (host === "youtu.be") id = url.pathname.slice(1, 12);
  else if (host === "youtube.com" || host === "youtube-nocookie.com") {
    id = url.searchParams.get("v") || "";
    const m = url.pathname.match(/^\/(?:shorts|live|embed)\/([\w-]{11})/);
    if (!id && m) id = m[1];
  }
  if (!/^[\w-]{11}$/.test(id)) return null;
  const t = url.searchParams.get("t") || url.searchParams.get("start") || "0";
  const hms = t.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s?)?$/);
  const start = hms ? Number(hms[1] || 0) * 3600 + Number(hms[2] || 0) * 60 + Number(hms[3] || 0) : 0;
  return { id, start };
}

/* ------------------------------------------------------------------ */
/* Sincronização: estado compartilhado pelo canal de dados do LiveKit  */
/* ------------------------------------------------------------------ */

export interface YtState {
  videoId: string;
  playing: boolean;
  /** posição em segundos no instante `at` */
  time: number;
  /** relógio LOCAL de quem recebeu (Date.now), para não depender do relógio dos outros */
  at: number;
  /** quem fez a última ação */
  by: string;
  byName: string;
}

type Msg =
  | { t: "state"; s: Omit<YtState, "at">; cmd: boolean }
  | { t: "stop"; byName: string }
  | { t: "req" };

const TOPIC = "yt";
const enc = new TextEncoder();
const dec = new TextDecoder();

export const expectedTime = (s: YtState) => (s.playing ? s.time + (Date.now() - s.at) / 1000 : s.time);

/** Quem responde pelo vídeo: quem fez a última ação, ou (se saiu) o primeiro da sala em ordem alfabética. */
function leaderOf(room: Room, s: YtState): string {
  const ids = [room.localParticipant.identity, ...room.remoteParticipants.keys()];
  return ids.includes(s.by) ? s.by : [...ids].sort()[0];
}

export function useYouTubeSync(room: Room | null, flash: (m: string) => void, onEnded?: () => boolean) {
  const onEndedRef = useRef(onEnded);
  useEffect(() => {
    onEndedRef.current = onEnded;
  }, [onEnded]);
  const [state, setState] = useState<YtState | null>(null);
  const stateRef = useRef<YtState | null>(null);
  const playerRef = useRef<YTPlayer | null>(null);

  const me = room?.localParticipant;

  const send = useCallback(
    (msg: Msg, to?: string[]) => {
      if (!room || room.state !== "connected") return;
      void room.localParticipant
        .publishData(enc.encode(JSON.stringify(msg)), { reliable: true, topic: TOPIC, destinationIdentities: to })
        .catch(() => {});
    },
    [room],
  );

  /** Leva o player local até o estado combinado. `tolerance` é o atraso aceitável em segundos. */
  const applyToPlayer = useCallback((s: YtState, tolerance: number) => {
    const p = playerRef.current;
    if (!p) return;
    const want = expectedTime(s);
    const current = p.getVideoData?.()?.video_id;
    if (current !== s.videoId) {
      if (s.playing) p.loadVideoById(s.videoId, want);
      else p.cueVideoById(s.videoId, want);
      return;
    }
    if (Math.abs(p.getCurrentTime() - want) > tolerance) p.seekTo(want, true);
    const ps = p.getPlayerState();
    const moving = ps === YT_STATE.PLAYING || ps === YT_STATE.BUFFERING;
    if (s.playing && !moving) p.playVideo();
    if (!s.playing && moving) p.pauseVideo();
  }, []);

  const set = useCallback((s: YtState | null) => {
    stateRef.current = s;
    setState(s);
  }, []);

  /** Aplica uma ação local e avisa todo mundo. */
  const commit = useCallback(
    (patch: Partial<YtState> & { videoId?: string }) => {
      if (!me) return;
      const prev = stateRef.current;
      const videoId = patch.videoId ?? prev?.videoId;
      if (!videoId) return;
      const s: YtState = {
        videoId,
        playing: patch.playing ?? prev?.playing ?? true,
        time: patch.time ?? (prev ? expectedTime(prev) : 0),
        at: Date.now(),
        by: me.identity,
        byName: me.name || "Alguém",
      };
      set(s);
      applyToPlayer(s, 0.4);
      const { at: _at, ...wire } = s;
      send({ t: "state", s: wire, cmd: true });
    },
    [applyToPlayer, me, send, set],
  );

  const localTime = () => playerRef.current?.getCurrentTime() ?? (stateRef.current ? expectedTime(stateRef.current) : 0);

  const load = useCallback(
    (input: string) => {
      const parsed = parseYouTube(input);
      if (!parsed) return false;
      commit({ videoId: parsed.id, time: parsed.start, playing: true });
      return true;
    },
    [commit],
  );
  const play = useCallback(() => commit({ playing: true, time: localTime() }), [commit]);
  const pause = useCallback(() => commit({ playing: false, time: localTime() }), [commit]);
  const seek = useCallback((t: number) => commit({ time: Math.max(0, t) }), [commit]);
  const stop = useCallback(() => {
    set(null);
    send({ t: "stop", byName: me?.name || "Alguém" });
  }, [me, send, set]);
  /** Puxa o estado de quem está controlando, caso o vídeo tenha se perdido. */
  const resync = useCallback(() => {
    if (stateRef.current) applyToPlayer(stateRef.current, 0.25);
    send({ t: "req" });
  }, [applyToPlayer, send]);

  // mensagens dos outros
  useEffect(() => {
    if (!room) return;
    const onData = (payload: Uint8Array, participant?: RemoteParticipant, _kind?: unknown, topic?: string) => {
      if (topic !== TOPIC || !participant) return;
      let msg: Msg;
      try {
        msg = JSON.parse(dec.decode(payload));
      } catch {
        return;
      }
      if (msg.t === "state") {
        if (!msg.s || typeof msg.s.videoId !== "string" || !/^[\w-]{11}$/.test(msg.s.videoId)) return;
        const prev = stateRef.current;
        const s: YtState = { ...msg.s, at: Date.now() };
        if (msg.cmd && prev?.videoId !== s.videoId) flash(`${s.byName} colocou um vídeo do YouTube`);
        set(s);
        applyToPlayer(s, msg.cmd ? 0.6 : 1.5);
      } else if (msg.t === "stop") {
        if (stateRef.current) flash(`${msg.byName} fechou o vídeo`);
        set(null);
      } else if (msg.t === "req") {
        const s = stateRef.current;
        if (!s) return;
        const { at: _at, ...wire } = s;
        send({ t: "state", s: { ...wire, time: localTime() }, cmd: false }, [participant.identity]);
      }
    };
    // quem chega depois: o líder manda o vídeo atual direto para a pessoa nova
    const timers: number[] = [];
    const onJoin = (p: RemoteParticipant) => {
      timers.push(
        window.setTimeout(() => {
          const s = stateRef.current;
          if (!s || leaderOf(room, s) !== room.localParticipant.identity) return;
          const { at: _at, ...wire } = s;
          send({ t: "state", s: { ...wire, time: localTime() }, cmd: false }, [p.identity]);
        }, 1500),
      );
    };
    room.on(RoomEvent.DataReceived, onData);
    room.on(RoomEvent.ParticipantConnected, onJoin);
    // e a pessoa nova também pergunta algumas vezes, caso a primeira mensagem se perca
    for (const ms of [800, 3000, 6000]) {
      timers.push(window.setTimeout(() => !stateRef.current && room.remoteParticipants.size && send({ t: "req" }), ms));
    }
    return () => {
      room.off(RoomEvent.DataReceived, onData);
      room.off(RoomEvent.ParticipantConnected, onJoin);
      timers.forEach((t) => window.clearTimeout(t));
    };
  }, [applyToPlayer, flash, room, send, set]);

  // batimento: o "líder" manda a posição a cada 4 s, e quem estiver atrasado se corrige
  useEffect(() => {
    if (!room) return;
    const id = window.setInterval(() => {
      const s = stateRef.current;
      const p = playerRef.current;
      if (!s || !s.playing || !p) return;
      if (leaderOf(room, s) !== room.localParticipant.identity) return;
      const { at: _at, ...wire } = s;
      send({ t: "state", s: { ...wire, time: p.getCurrentTime() }, cmd: false });
    }, 4000);
    return () => window.clearInterval(id);
  }, [room, send]);

  /** Chamado pelo componente do player quando o iframe fica pronto. */
  const registerPlayer = useCallback(
    (p: YTPlayer | null) => {
      playerRef.current = p;
      if (p && stateRef.current) applyToPlayer(stateRef.current, 0.4);
    },
    [applyToPlayer],
  );

  /** Fim do vídeo: o líder pausa no final para todo mundo ficar igual. */
  const onPlayerState = useCallback(
    (ps: number) => {
      const s = stateRef.current;
      if (!s || !me) return;
      if (ps === YT_STATE.ENDED && s.playing && s.by === me.identity) {
        // tem fila? o próximo vídeo entra no lugar
        if (onEndedRef.current?.()) return;
        commit({ playing: false, time: playerRef.current?.getDuration() ?? s.time });
      }
    },
    [commit, me],
  );

  return { state, load, play, pause, seek, stop, resync, registerPlayer, onPlayerState, playerRef };
}

export type YouTubeSync = ReturnType<typeof useYouTubeSync>;
