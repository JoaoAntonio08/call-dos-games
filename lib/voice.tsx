"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { RoomEvent, type RemoteParticipant, type Track } from "livekit-client";
import { api, upload } from "./api";
import { gateway, loadQueue, setQueue, useStore } from "./store";
import { useCall, type Call, type PeerMeta } from "./use-call";
import { useYouTubeSync } from "./use-youtube-sync";
import { useClipper } from "./clipper";
import { toast } from "./ui";
import type { Attachment, QueueItem, Sound } from "./types";
import { TrackAudio } from "@/components/room/media";

/* ------------------------------------------------------------------ */
/* preferências de voz (ficam no navegador)                            */
/* ------------------------------------------------------------------ */

export interface VoicePrefs {
  ptt: boolean;
  pttKey: string; // KeyboardEvent.code
  noiseSuppression: boolean;
  /** soundboard e efeitos */
  sfxVolume: number;
  /** sons de entrada/saída da call (separado dos efeitos) */
  joinVolume: number;
  joinSounds: boolean;
  startMuted: boolean;
  /** guarda os últimos ~40 s da call (tela ou só áudio) para clipar */
  clipBuffer: boolean;
}

const DEFAULT_PREFS: VoicePrefs = { ptt: false, pttKey: "KeyV", noiseSuppression: true, sfxVolume: 0.7, joinVolume: 0.7, joinSounds: true, startMuted: false, clipBuffer: true };

function loadPrefs(): VoicePrefs {
  try {
    const saved = JSON.parse(localStorage.getItem("cdg:voice") || "{}");
    // antes era um volume só para tudo: quem já tinha ajustado continua com o mesmo valor nos dois
    if (saved.joinVolume === undefined && typeof saved.sfxVolume === "number") saved.joinVolume = saved.sfxVolume;
    return { ...DEFAULT_PREFS, ...saved };
  } catch {
    return DEFAULT_PREFS;
  }
}

/* ------------------------------------------------------------------ */
/* sinos de entrada/saída, sintetizados (sem arquivo)                  */
/* ------------------------------------------------------------------ */

let audioCtx: AudioContext | null = null;
export function chime(kind: "join" | "leave" | "self" | "ping", volume = 0.5) {
  try {
    audioCtx ??= new AudioContext();
    const ctx = audioCtx;
    const notes = { join: [523.25, 783.99], leave: [659.25, 440], self: [440, 554.37, 659.25], ping: [880] }[kind];
    notes.forEach((f, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = "sine";
      o.frequency.value = f;
      const t = ctx.currentTime + i * 0.09;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.16 * volume, t + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.45);
      o.connect(g).connect(ctx.destination);
      o.start(t);
      o.stop(t + 0.5);
    });
  } catch {
    /* sem áudio */
  }
}

function playUrl(url: string, volume: number) {
  const a = new Audio(url);
  a.volume = Math.max(0, Math.min(1, volume));
  void a.play().catch(() => {});
  // som de soundboard tem teto de 8 s, para ninguém tocar um álbum inteiro
  window.setTimeout(() => a.pause(), 8000);
}

/* ------------------------------------------------------------------ */
/* atividades                                                          */
/* ------------------------------------------------------------------ */

export interface Stroke {
  id: string;
  color: string;
  size: number;
  pts: number[]; // x0,y0,x1,y1… normalizados 0..1
}

export interface Spin {
  id: string;
  options: string[];
  winner: number;
  by: string;
  at: number;
}

export interface FloatingReaction {
  id: number;
  emoji: string;
  name: string;
  x: number;
}

const NO_QUEUE: QueueItem[] = [];
const enc = new TextEncoder();
const dec = new TextDecoder();

/* ------------------------------------------------------------------ */
/* contexto                                                            */
/* ------------------------------------------------------------------ */

interface VoiceCtx {
  call: Call;
  yt: ReturnType<typeof useYouTubeSync>;
  channelId: string | null;
  joining: string | null;
  deaf: boolean;
  prefs: VoicePrefs;
  pttDown: boolean;
  voiceVol: Record<string, number>;
  screenVol: Record<string, number>;
  /** silenciados só para mim */
  localMute: Record<string, boolean>;
  setLocalMute: (id: string, v: boolean) => void;
  /** um admin te mutou / tirou seu som para todos */
  serverMute: boolean;
  serverDeaf: boolean;
  strokes: Stroke[];
  spin: Spin | null;
  reactions: FloatingReaction[];
  join: (channelId: string) => Promise<void>;
  leave: () => Promise<void>;
  setDeaf: (v: boolean) => void;
  setPrefs: (p: Partial<VoicePrefs>) => void;
  setVoiceVol: (id: string, v: number) => void;
  setScreenVol: (id: string, v: number) => void;
  playSound: (s: Sound) => void;
  react: (emoji: string) => void;
  addStroke: (s: Stroke) => void;
  clearBoard: () => void;
  startSpin: (options: string[]) => void;
  /** fila de vídeos do canal da call */
  queue: QueueItem[];
  playQueued: (item: QueueItem) => Promise<void>;
  /** pode pausar/pular a música dos outros e tirar qualquer uma da fila */
  isDj: boolean;
  /** clipar momento */
  clip: {
    available: boolean;
    supported: boolean;
    busy: boolean;
    save: () => Promise<void>;
    /** "audio" quando não tem tela nenhuma: o clipe sai só com as vozes */
    kind: "video" | "audio";
    /** sua tela gravando só para clipes (sem transmitir) */
    ownScreen: boolean;
    toggleOwnScreen: () => Promise<void>;
  };
}

const Ctx = createContext<VoiceCtx | null>(null);

export function useVoice() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useVoice fora do VoiceProvider");
  return v;
}

export function VoiceProvider({ children }: { children: React.ReactNode }) {
  const call = useCall();
  // fim do vídeo: se tiver fila, o próximo entra sozinho (a função de verdade é definida mais abaixo)
  const endedRef = useRef<() => boolean>(() => false);
  const onEnded = useCallback(() => endedRef.current(), []);
  const me = useStore((s) => s.me);
  const [channelId, setChannelId] = useState<string | null>(null);
  // DJ: pausa e pula a música dos outros (admin, dono, cargo com DJ; numa conversa direta, todo mundo)
  const isDj = useStore((s) => {
    if (!channelId) return false;
    const srv = Object.values(s.servers).find((x) => x.channels.some((c) => c.id === channelId));
    return !srv || !!srv.my_perms?.includes("dj");
  });
  const yt = useYouTubeSync(call.room, call.flash, onEnded, isDj);
  const [joining, setJoining] = useState<string | null>(null);
  const [deaf, setDeafState] = useState(false);
  const [prefs, setPrefsState] = useState<VoicePrefs>(DEFAULT_PREFS);
  const [pttDown, setPttDown] = useState(false);
  const [voiceVol, setVV] = useState<Record<string, number>>({});
  const [screenVol, setSV] = useState<Record<string, number>>({});
  const [localMute, setLM] = useState<Record<string, boolean>>({});
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [spin, setSpin] = useState<Spin | null>(null);
  const [reactions, setReactions] = useState<FloatingReaction[]>([]);
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;
  const deafRef = useRef(deaf);
  deafRef.current = deaf;
  const strokesRef = useRef(strokes);
  strokesRef.current = strokes;

  useEffect(() => {
    setPrefsState(loadPrefs());
    try {
      setVV(JSON.parse(localStorage.getItem("cdg:vol") || "{}"));
      setLM(JSON.parse(localStorage.getItem("cdg:mudos") || "{}"));
    } catch {
      /* nada salvo */
    }
  }, []);

  const setPrefs = useCallback((p: Partial<VoicePrefs>) => {
    setPrefsState((cur) => {
      const next = { ...cur, ...p };
      try {
        localStorage.setItem("cdg:voice", JSON.stringify(next));
      } catch {
        /* sem armazenamento */
      }
      return next;
    });
  }, []);

  const setVoiceVol = useCallback((id: string, v: number) => {
    setVV((m) => {
      const next = { ...m, [id]: v };
      try {
        localStorage.setItem("cdg:vol", JSON.stringify(next));
      } catch {
        /* sem armazenamento */
      }
      return next;
    });
  }, []);
  const setScreenVol = useCallback((id: string, v: number) => setSV((m) => ({ ...m, [id]: v })), []);
  const setLocalMute = useCallback((id: string, v: boolean) => {
    setLM((m) => {
      const next = { ...m };
      if (v) next[id] = true;
      else delete next[id];
      try {
        localStorage.setItem("cdg:mudos", JSON.stringify(next));
      } catch {
        /* sem armazenamento */
      }
      return next;
    });
  }, []);

  /* ---------------- estado de voz para o servidor (quem está em cada canal) ---------------- */
  const local = call.peers.find((p) => p.isLocal);
  const report = useCallback(() => {
    if (!channelId) return;
    gateway.send({
      op: "voice",
      channel_id: channelId,
      mic: !!local?.micOn || (prefsRef.current.ptt && !deafRef.current),
      deaf,
      video: !!local?.camera,
      stream: !!local?.screen,
    });
  }, [channelId, local?.micOn, local?.camera, local?.screen, deaf]);
  useEffect(() => {
    if (call.status === "connected") report();
  }, [report, call.status]);
  useEffect(() => gateway.onHello(report), [report]);

  /* ---------------- entrar / sair ---------------- */
  const leave = useCallback(async () => {
    if (channelId) chime("leave", prefsRef.current.joinVolume);
    await call.leave();
    gateway.send({ op: "voice", channel_id: null });
    setChannelId(null);
    setStrokes([]);
    setSpin(null);
  }, [call, channelId]);

  const join = useCallback(
    async (cid: string) => {
      if (channelId === cid || joining) return;
      if (channelId) {
        await call.leave();
        setStrokes([]);
        setSpin(null);
      }
      setJoining(cid);
      const p = prefsRef.current;
      const ok = await call.join(() => api<{ token: string; url: string }>("/voice/token", { json: { channel_id: cid } }), {
        mic: !p.ptt && !p.startMuted,
        camera: false,
        quiet: true,
        noiseSuppression: p.noiseSuppression,
        onPeerJoin: (_name: string, meta: PeerMeta) => {
          if (deafRef.current) return;
          if (prefsRef.current.joinSounds && meta.join_sound) playUrl(meta.join_sound, prefsRef.current.joinVolume);
          else chime("join", prefsRef.current.joinVolume);
        },
        onPeerLeave: () => !deafRef.current && chime("leave", prefsRef.current.joinVolume),
      });
      setJoining(null);
      if (!ok) return;
      setChannelId(cid);
      // seu próprio som de entrada, para você saber que entrou
      const mine = useStore.getState().me?.join_sound;
      if (p.joinSounds && mine) playUrl(mine, p.joinVolume);
      else chime("self", p.joinVolume);
    },
    [call, channelId, joining],
  );

  // a call caiu de vez (erro): limpa o canal
  useEffect(() => {
    if ((call.status === "error" || call.status === "disconnected") && channelId) {
      setChannelId(null);
      setStrokes([]);
      setSpin(null);
      // saiu porque entrou em outro aparelho: o outro já avisou o servidor, não apaga a presença dele
      if (call.endReason !== "elsewhere") gateway.send({ op: "voice", channel_id: null });
    }
    if (call.status === "error") setJoining(null);
  }, [call.status, call.endReason, channelId]);

  // a call foi para outro aparelho seu (ex.: entrou pelo celular): avisa em qualquer tela
  useEffect(() => {
    if (call.endReason === "elsewhere") toast("Você entrou nessa call em outro aparelho, então saiu por aqui.");
  }, [call.endReason]);

  /* ---------------- o que um admin decidiu para você ---------------- */
  const here = useStore((s) => (channelId ? s.voice[channelId] : undefined));
  const myState = here?.find((m) => m.user_id === me?.id);
  const serverMute = !!myState?.smute;
  const serverDeaf = !!myState?.sdeaf;
  const serverMuteRef = useRef(serverMute);
  useEffect(() => {
    serverMuteRef.current = serverMute;
  }, [serverMute]);
  useEffect(() => {
    if (!serverMute || !channelId) return;
    void call.setMic(false);
    toast("Um admin mutou você para todos.");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverMute, channelId]);
  useEffect(() => {
    if (serverMute && local?.micOn) void call.setMic(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverMute, local?.micOn]);
  useEffect(() => {
    if (serverDeaf && channelId) toast("Um admin tirou o som da call para você.");
  }, [serverDeaf, channelId]);
  /** volume de alguém escolhido por um admin, para todos (0..1) */
  const gainOf = useCallback((id: string) => here?.find((m) => m.user_id === id)?.gain ?? 1, [here]);

  // admin te moveu de sala ou te tirou da call
  const joinRef = useRef(join);
  const leaveRef = useRef(leave);
  useEffect(() => {
    joinRef.current = join;
    leaveRef.current = leave;
  }, [join, leave]);
  useEffect(() => {
    const onMove = (e: Event) => {
      const d = (e as CustomEvent).detail as { channel_id: string; channel_name: string; by: string };
      toast(d.by + " levou você para " + d.channel_name + ".");
      void joinRef.current(d.channel_id);
    };
    const onKick = (e: Event) => {
      const d = (e as CustomEvent).detail as { by: string };
      toast(d.by + " tirou você da call.");
      void leaveRef.current();
    };
    window.addEventListener("cdg:voice-move", onMove);
    window.addEventListener("cdg:voice-kick", onKick);
    return () => {
      window.removeEventListener("cdg:voice-move", onMove);
      window.removeEventListener("cdg:voice-kick", onKick);
    };
  }, []);

  /* ---------------- ensurdecer: corta o mic junto, como no Discord ---------------- */
  const micBeforeDeaf = useRef(true);
  const setDeaf = useCallback(
    (v: boolean) => {
      setDeafState(v);
      if (v) {
        micBeforeDeaf.current = !!call.peers.find((p) => p.isLocal)?.micOn;
        void call.setMic(false);
      } else if (micBeforeDeaf.current && !prefsRef.current.ptt) void call.setMic(true);
    },
    [call],
  );

  /* ---------------- apertar para falar ---------------- */
  useEffect(() => {
    if (!prefs.ptt || !channelId) return;
    void call.setMic(false);
    const typing = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      return !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);
    };
    const down = (e: KeyboardEvent) => {
      if (e.code !== prefs.pttKey || e.repeat || typing(e) || deafRef.current || serverMuteRef.current) return;
      setPttDown(true);
      void call.setMic(true);
    };
    const up = (e: KeyboardEvent) => {
      if (e.code !== prefs.pttKey) return;
      setPttDown(false);
      void call.setMic(false);
    };
    const blur = () => {
      setPttDown(false);
      void call.setMic(false);
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefs.ptt, prefs.pttKey, channelId]);

  useEffect(() => {
    if (channelId) void call.setNoiseSuppression(prefs.noiseSuppression);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefs.noiseSuppression]);

  /* ---------------- canal de dados: soundboard, reações, quadro, roleta ---------------- */
  const room = call.room;
  const publish = useCallback(
    (topic: string, payload: unknown) => {
      void room?.localParticipant.publishData(enc.encode(JSON.stringify(payload)), { reliable: true, topic }).catch(() => {});
    },
    [room],
  );

  const pushReaction = useCallback((emoji: string, name: string) => {
    const id = Date.now() + Math.random();
    setReactions((r) => [...r.slice(-24), { id, emoji, name, x: 8 + Math.random() * 84 }]);
    window.setTimeout(() => setReactions((r) => r.filter((x) => x.id !== id)), 2700);
  }, []);

  useEffect(() => {
    if (!room) return;
    let gotSync = false;
    const onData = (data: Uint8Array, p?: RemoteParticipant, _k?: unknown, topic?: string) => {
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(dec.decode(data));
      } catch {
        return;
      }
      const name = p?.name || "Alguém";
      if (topic === "sfx" && typeof msg.url === "string") {
        if (!deafRef.current) playUrl(msg.url, prefsRef.current.sfxVolume * (Number(msg.volume) || 1));
        pushReaction(String(msg.emoji || "🔊"), name);
      } else if (topic === "react" && typeof msg.emoji === "string") {
        pushReaction(msg.emoji.slice(0, 16), name);
      } else if (topic === "board") {
        if (msg.type === "stroke") setStrokes((s) => (s.some((x) => x.id === (msg.stroke as Stroke).id) ? s : [...s, msg.stroke as Stroke]));
        else if (msg.type === "clear") setStrokes([]);
        else if (msg.type === "req" && strokesRef.current.length) {
          // responde com um atraso aleatório; quem responder primeiro basta
          window.setTimeout(() => {
            if (gotSync) return;
            for (const s of strokesRef.current) publish("board", { type: "stroke", stroke: s });
          }, Math.random() * 500);
        } else if (msg.type === "stroke-sync") gotSync = true;
      } else if (topic === "spin" && Array.isArray(msg.options)) {
        setSpin(msg as unknown as Spin);
      }
    };
    room.on(RoomEvent.DataReceived, onData);
    // acabou de entrar: pede o quadro para quem já está desenhando
    publish("board", { type: "req" });
    return () => {
      room.off(RoomEvent.DataReceived, onData);
    };
  }, [room, publish, pushReaction]);

  const playSound = useCallback(
    (s: Sound) => {
      publish("sfx", { url: s.url, volume: s.volume, emoji: s.emoji || "🔊", name: s.name });
      if (!deafRef.current) playUrl(s.url, prefsRef.current.sfxVolume * s.volume);
      pushReaction(s.emoji || "🔊", me?.display_name ?? "Você");
    },
    [publish, pushReaction, me?.display_name],
  );

  const react = useCallback(
    (emoji: string) => {
      publish("react", { emoji });
      pushReaction(emoji, me?.display_name ?? "Você");
    },
    [publish, pushReaction, me?.display_name],
  );

  const addStroke = useCallback(
    (s: Stroke) => {
      setStrokes((cur) => [...cur, s]);
      publish("board", { type: "stroke", stroke: s });
    },
    [publish],
  );
  const clearBoard = useCallback(() => {
    setStrokes([]);
    publish("board", { type: "clear" });
  }, [publish]);

  const startSpin = useCallback(
    (options: string[]) => {
      const s: Spin = { id: Math.random().toString(36).slice(2), options, winner: Math.floor(Math.random() * options.length), by: me?.display_name ?? "Alguém", at: Date.now() };
      setSpin(s);
      publish("spin", s);
    },
    [publish, me?.display_name],
  );

  /* ---------------- fila de vídeos ---------------- */
  const queue = useStore((s) => (channelId ? s.queue[channelId] : undefined)) ?? NO_QUEUE;
  useEffect(() => {
    if (channelId) void loadQueue(channelId).catch(() => {});
  }, [channelId]);

  const ytLoad = yt.load;
  const playQueued = useCallback(
    async (item: QueueItem) => {
      if (!channelId) return;
      // a música continua sendo de quem pôs na fila (é essa pessoa que pausa e pula)
      const owner = item.added_by ? { id: item.added_by, name: useStore.getState().users[item.added_by]?.display_name ?? "Alguém" } : undefined;
      ytLoad(`https://www.youtube.com/watch?v=${item.video_id}&t=${item.start}s`, owner);
      try {
        setQueue(channelId, await api<QueueItem[]>(`/queue/${item.id}?played=1`, { method: "DELETE" }));
      } catch {
        /* alguém já tirou */
      }
    },
    [channelId, ytLoad],
  );
  useEffect(() => {
    endedRef.current = () => {
      const next = channelId ? useStore.getState().queue[channelId]?.[0] : undefined;
      if (!next) return false;
      void playQueued(next);
      return true;
    };
  }, [channelId, playQueued]);

  // nada tocando e alguém pôs música na fila (/tocar no chat): a primeira da sala começa sozinha
  const queueLen = useRef(queue.length);
  const ytState = yt.state;
  const ytPlayer = yt.playerRef;
  useEffect(() => {
    const grew = queue.length > queueLen.current;
    queueLen.current = queue.length;
    // "parado" = sem vídeo, ou o último terminou (pausado no fim)
    const idle = !ytState || (!ytState.playing && ytPlayer.current?.getPlayerState() === 0);
    if (!grew || !idle || !room || room.state !== "connected" || !queue[0]) return;
    const ids = [room.localParticipant.identity, ...room.remoteParticipants.keys()].sort();
    if (ids[0] === room.localParticipant.identity) void playQueued(queue[0]);
  }, [queue, ytState, ytPlayer, room, playQueued]);

  /* ---------------- clipar momento ---------------- */
  const sharer = call.peers.find((p) => !p.isLocal && p.screen) ?? call.peers.find((p) => p.screen);
  // sem live: dá para gravar a própria tela só para clipes (fica no seu PC, ninguém recebe)
  const [ownRaw, setOwnScreen] = useState<MediaStream | null>(null);
  // só vale dentro da call: saiu, para de gravar
  const ownScreen = channelId ? ownRaw : null;
  useEffect(() => {
    if (!ownRaw) return;
    const tracks = ownRaw.getTracks();
    const end = () => setOwnScreen((s) => (s === ownRaw ? null : s));
    tracks[0]?.addEventListener("ended", end);
    return () => {
      tracks[0]?.removeEventListener("ended", end);
      for (const t of tracks) t.stop();
    };
  }, [ownRaw]);
  useEffect(() => {
    if (!channelId) for (const t of ownRaw?.getTracks() ?? []) t.stop();
  }, [channelId, ownRaw]);
  const toggleOwnScreen = useCallback(async () => {
    if (ownScreen) {
      setOwnScreen(null);
      return;
    }
    try {
      const s = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 30 }, height: { ideal: 1080 } }, audio: true });
      setOwnScreen(s);
      toast("Gravando sua tela só para clipes. Ninguém está vendo. Alt+C salva o lance.");
    } catch {
      /* desistiu de escolher */
    }
  }, [ownScreen]);
  const ownVideo = ownScreen?.getVideoTracks()[0];
  const useOwn = !sharer?.screen && !!ownVideo;
  const clipAudio: Track[] = channelId ? [sharer?.screenAudio, ...call.peers.map((p) => p.mic)].filter((t): t is Track => !!t) : [];
  const clipper = useClipper({
    enabled: !!channelId && prefs.clipBuffer,
    video: channelId ? (sharer?.screen?.mediaStreamTrack ?? (useOwn ? ownVideo : undefined)) : undefined,
    audio: clipAudio,
    extraAudio: useOwn ? ownScreen!.getAudioTracks() : [],
  });
  const clipperClip = clipper.clip;
  const sharerName = sharer ? (sharer.isLocal ? me?.display_name : sharer.name) : useOwn ? me?.display_name : undefined;
  const saveClip = useCallback(async () => {
    if (!channelId) return;
    const res = await clipperClip();
    if (!res) {
      toast("Não deu para clipar agora. Tenta de novo em alguns segundos.");
      return;
    }
    const st = useStore.getState();
    const server = Object.values(st.servers).find((s) => s.channels.some((c) => c.id === channelId));
    const voiceName = server?.channels.find((c) => c.id === channelId)?.name;
    // vai para o canal de clipes do servidor (ou o primeiro de texto); na conversa direta, para a própria conversa
    const target = server
      ? (server.channels.find((c) => c.type === "text" && /clip/i.test(c.name)) ?? server.channels.find((c) => c.type === "text"))
      : { id: channelId, name: "" };
    if (!target) return;
    const d = new Date();
    const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}-${String(d.getHours()).padStart(2, "0")}${String(d.getMinutes()).padStart(2, "0")}`;
    const file = new File([res.blob], `clipe-${stamp}.${res.ext}`, { type: res.blob.type });
    toast(`Salvando clipe de ${res.seconds}s…`);
    try {
      const up = await upload<Attachment>("/files?clip=1", file);
      await api(`/channels/${target.id}/messages`, {
        json: {
          content:
            res.kind === "audio"
              ? `🎙️ Clipe de áudio${voiceName ? ` da ${voiceName}` : " da call"}`
              : `🎬 Clipe${sharerName ? ` da tela de ${sharerName}` : ""}${voiceName ? ` na ${voiceName}` : ""}`,
          attachment_ids: [up.id],
        },
      });
      toast(server ? `Clipe salvo no #${target.name}.` : "Clipe salvo na conversa.");
      // no app de Windows o atalho funciona com o jogo na frente: o sininho avisa que salvou
      if (document.hidden || !document.hasFocus()) chime("ping", prefs.sfxVolume * 0.6);
      publish("react", { emoji: "🎬" });
      pushReaction("🎬", me?.display_name ?? "Você");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Não deu para salvar o clipe.");
    }
  }, [channelId, clipperClip, sharerName, publish, pushReaction, me?.display_name, prefs.sfxVolume]);
  const clip = useMemo(
    () => ({
      available: clipper.ready,
      supported: clipper.supported,
      busy: clipper.busy,
      save: saveClip,
      kind: clipper.kind,
      ownScreen: !!ownScreen,
      toggleOwnScreen,
    }),
    [clipper.ready, clipper.supported, clipper.busy, clipper.kind, saveClip, ownScreen, toggleOwnScreen],
  );

  // app de Windows: atalho global (Alt+Shift+C) clipa mesmo com o jogo na frente
  const clipNow = useRef<(() => void) | null>(null);
  useEffect(() => {
    clipNow.current = clipper.ready && !clipper.busy ? () => void saveClip() : null;
  }, [clipper.ready, clipper.busy, saveClip]);
  useEffect(() => {
    const desk = (window as unknown as { cdgDesktop?: { onClip?: (cb: () => void) => () => void } }).cdgDesktop;
    return desk?.onClip?.(() => clipNow.current?.());
  }, []);

  // sair da call ao fazer logout
  useEffect(() => {
    if (!me && channelId) void leave();
  }, [me, channelId, leave]);

  const value = useMemo<VoiceCtx>(
    () => ({
      call,
      yt,
      channelId,
      joining,
      deaf,
      prefs,
      pttDown,
      voiceVol,
      screenVol,
      localMute,
      setLocalMute,
      serverMute,
      serverDeaf,
      strokes,
      spin,
      reactions,
      join,
      leave,
      setDeaf,
      setPrefs,
      setVoiceVol,
      setScreenVol,
      playSound,
      react,
      addStroke,
      clearBoard,
      startSpin,
      queue,
      playQueued,
      isDj,
      clip,
    }),
    [call, yt, channelId, joining, deaf, prefs, pttDown, voiceVol, screenVol, localMute, setLocalMute, serverMute, serverDeaf, strokes, spin, reactions, join, leave, setDeaf, setPrefs, setVoiceVol, setScreenVol, playSound, react, addStroke, clearBoard, startSpin, queue, playQueued, isDj, clip],
  );

  return (
    <Ctx.Provider value={value}>
      {children}
      {/* o áudio de todo mundo fica aqui em cima: continua tocando enquanto você navega pelo chat */}
      <div hidden>
        {call.peers
          .filter((p) => !p.isLocal)
          .map((p) => (
            <span key={p.identity}>
              {p.mic && (
                <TrackAudio track={p.mic} volume={deaf || serverDeaf || localMute[p.identity] ? 0 : (voiceVol[p.identity] ?? 1) * gainOf(p.identity)} />
              )}
              {p.screenAudio && <TrackAudio track={p.screenAudio} volume={deaf || serverDeaf ? 0 : (screenVol[p.identity] ?? 1)} />}
            </span>
          ))}
      </div>
    </Ctx.Provider>
  );
}
