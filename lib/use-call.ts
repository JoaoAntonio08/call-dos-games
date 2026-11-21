"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { SpeakingDetector } from "./speaking";
import { problemFromDisconnect, problemFromError, type CallProblem } from "./call-errors";
import {
  AudioPresets,
  ConnectionState,
  DisconnectReason,
  LocalAudioTrack,
  LocalTrack,
  Room,
  RoomEvent,
  Track,
  TrackEvent,
  VideoPresets,
  type AudioCaptureOptions,
  type Participant,
  type VideoCodec,
} from "livekit-client";

/**
 * Pede ao navegador para tirar do "som do PC" o que esta própria página toca.
 * Sem isso, quem compartilha a tela com som manda de volta as vozes da call e todo mundo escuta eco.
 * Chrome/Edge/WebView2 recentes entendem; os outros ignoram a opção (fica como antes).
 */
export const OWN_AUDIO_OFF = { restrictOwnAudio: true } as const;

/* ------------------------------------------------------------------ */
/* Qualidade do compartilhamento de tela                               */
/* ------------------------------------------------------------------ */

export const RESOLUTIONS = {
  "720p": { width: 1280, height: 720, label: "720p" },
  "1080p": { width: 1920, height: 1080, label: "1080p" },
  "1440p": { width: 2560, height: 1440, label: "1440p" },
  "2160p": { width: 3840, height: 2160, label: "4K" },
} as const;
export type ResolutionId = keyof typeof RESOLUTIONS;
const RES_ORDER: ResolutionId[] = ["720p", "1080p", "1440p", "2160p"];

/** A maior resolução permitida que não passa do limite do servidor. */
export function clampResolution(res: ResolutionId, cap: ResolutionId): ResolutionId {
  return RES_ORDER.indexOf(res) > RES_ORDER.indexOf(cap) ? cap : res;
}
export function aboveCap(res: ResolutionId, cap: ResolutionId): boolean {
  return RES_ORDER.indexOf(res) > RES_ORDER.indexOf(cap);
}

export type ShareMode = "video" | "game";

export interface ShareSettings {
  resolution: ResolutionId;
  fps: 30 | 60;
  mode: ShareMode;
  audio: boolean;
  codec: VideoCodec;
}

/** Padrão econômico: cabe bem na franquia grátis do LiveKit Cloud. */
export const DEFAULT_SHARE: ShareSettings = {
  resolution: "720p",
  fps: 30,
  mode: "video",
  audio: true,
  codec: "h264",
};

/** Bitrate máximo de envio (bits/s) para cada combinação. Ajustado para conteúdo com muito movimento. */
export function bitrateFor(res: ResolutionId, fps: 30 | 60): number {
  const table: Record<ResolutionId, [number, number]> = {
    "720p": [2_500_000, 4_000_000],
    "1080p": [5_000_000, 8_000_000],
    "1440p": [9_000_000, 14_000_000],
    "2160p": [16_000_000, 25_000_000],
  };
  return table[res][fps === 60 ? 1 : 0];
}

/** Franquia mensal de dados do plano grátis (Build) do LiveKit Cloud, em GB. */
export const FREE_TIER_GB = 50;

/** GB por hora que cada pessoa assistindo consome, no pior caso (bitrate máximo). */
export function gbPerHour(res: ResolutionId, fps: 30 | 60): number {
  return (bitrateFor(res, fps) * 3600) / 8 / 1e9;
}

/* ------------------------------------------------------------------ */
/* Estado de cada pessoa na call                                       */
/* ------------------------------------------------------------------ */

export interface Peer {
  identity: string;
  name: string;
  isLocal: boolean;
  speaking: boolean;
  micOn: boolean;
  mic?: Track;
  camera?: Track;
  screen?: Track;
  screenAudio?: Track;
  /** dados do perfil que o servidor coloca no token (foto, cor, som de entrada) */
  meta: PeerMeta;
}

export interface PeerMeta {
  avatar?: { url: string; still: string; animated: boolean } | null;
  accent?: string;
  username?: string;
  join_sound?: string | null;
}

export function parseMeta(raw: string | undefined): PeerMeta {
  if (!raw) return {};
  try {
    return JSON.parse(raw) as PeerMeta;
  } catch {
    return {};
  }
}

function trackOf(p: Participant, source: Track.Source): Track | undefined {
  const pub = p.getTrackPublication(source);
  if (!pub || pub.isMuted || !pub.track) return undefined;
  return pub.track;
}

function snapshot(room: Room, det?: SpeakingDetector | null): Peer[] {
  const all: Participant[] = [room.localParticipant, ...room.remoteParticipants.values()];
  return all.map((p) => {
    const micPub = p.getTrackPublication(Track.Source.Microphone);
    return {
      identity: p.identity,
      name: p.name || p.identity.split("#")[0],
      isLocal: p === room.localParticipant,
      // medido aqui no aparelho (na hora); se não deu para medir, vale o aviso do servidor
      speaking: det?.speaking(p.identity) ?? p.isSpeaking,
      micOn: !!micPub && !micPub.isMuted,
      mic: trackOf(p, Track.Source.Microphone),
      camera: trackOf(p, Track.Source.Camera),
      screen: trackOf(p, Track.Source.ScreenShare),
      screenAudio: trackOf(p, Track.Source.ScreenShareAudio),
      meta: parseMeta(p.metadata),
    };
  });
}

/** Quem chama decide de onde vem o token (call rápida por chave ou canal de servidor). */
export type TokenFetcher = () => Promise<{ token: string; url: string; quality?: { max_resolution?: string } }>;

/** Token da call rápida (sem conta), gerado pela rota /api/token do próprio site. */
export function keyTokenFetcher(key: string, name: string): TokenFetcher {
  return async () => {
    const res = await fetch("/api/token", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ key, name }),
    });
    const data = (await res.json().catch(() => ({}))) as { token?: string; url?: string; error?: string };
    if (!res.ok || !data.token || !data.url) throw new Error(data.error || "Não foi possível entrar na sala.");
    return { token: data.token, url: data.url };
  };
}

export type CallStatus = "idle" | "connecting" | "connected" | "reconnecting" | "disconnected" | "error";

function describeMediaError(err: unknown, what: string): string {
  const name = err instanceof Error ? err.name : "";
  if (name === "NotAllowedError") return `Permissão negada para ${what}. Libere no cadeado da barra de endereço.`;
  if (name === "NotFoundError") return `Nenhum dispositivo de ${what} encontrado.`;
  if (name === "NotReadableError") return `O dispositivo de ${what} está sendo usado por outro programa.`;
  return `Não foi possível ligar ${what}.`;
}

export function useCall() {
  const roomRef = useRef<Room | null>(null);
  const screenTracks = useRef<LocalTrack[]>([]);
  const [status, setStatus] = useState<CallStatus>("idle");
  const [error, setError] = useState<string>("");
  const [notice, setNotice] = useState<string>("");
  const [peers, setPeers] = useState<Peer[]>([]);
  const [canPlayAudio, setCanPlayAudio] = useState(true);
  const [sharing, setSharing] = useState<ShareSettings | null>(null);
  const sharingRef = useRef<ShareSettings | null>(null);
  useEffect(() => {
    sharingRef.current = sharing;
  }, [sharing]);
  /** até que resolução o servidor deixa compartilhar agora (cai quando ele está cheio) */
  const [shareCap, setShareCapState] = useState<ResolutionId>("2160p");
  const shareCapRef = useRef<ResolutionId>("2160p");
  const [room, setRoom] = useState<Room | null>(null);
  /** por que a última call acabou sem você clicar em sair */
  const [endReason, setEndReason] = useState<"elsewhere" | "removed" | null>(null);
  /** o que deu errado ao entrar ou por que a call caiu, já em português (null = nada) */
  const [problem, setProblem] = useState<CallProblem | null>(null);

  const detRef = useRef<SpeakingDetector | null>(null);
  const refresh = useCallback(() => {
    const r = roomRef.current;
    if (!r) return;
    const det = (detRef.current ??= new SpeakingDetector(() => {
      const room = roomRef.current;
      if (room) setPeers(snapshot(room, detRef.current));
    }));
    const all: Participant[] = [r.localParticipant, ...r.remoteParticipants.values()];
    det.sync(new Map(all.map((p) => [p.identity, trackOf(p, Track.Source.Microphone)?.mediaStreamTrack])));
    setPeers(snapshot(r, det));
  }, []);
  const stopDetector = useCallback(() => {
    detRef.current?.close();
    detRef.current = null;
  }, []);

  const flash = useCallback((msg: string) => setNotice(msg), []);
  useEffect(() => {
    if (!notice) return;
    const t = window.setTimeout(() => setNotice(""), 4500);
    return () => window.clearTimeout(t);
  }, [notice]);

  const stopShare = useCallback(async () => {
    const r = roomRef.current;
    const tracks = screenTracks.current;
    screenTracks.current = [];
    setSharing(null);
    if (!r) return;
    for (const t of tracks) {
      try {
        await r.localParticipant.unpublishTrack(t, true);
      } catch {
        t.stop();
      }
    }
    refresh();
  }, [refresh]);

  const join = useCallback(
    async (getToken: TokenFetcher, opts: {
      mic: boolean;
      camera: boolean;
      noiseSuppression?: boolean;
      /** sem avisos de entrou/saiu (o app de servidores tem os próprios sons) */
      quiet?: boolean;
      onPeerJoin?: (name: string, meta: PeerMeta) => void;
      onPeerLeave?: (name: string) => void;
    }) => {
      if (roomRef.current) return false;
      setEndReason(null);
      setProblem(null);
      setStatus("connecting");
      setError("");
      try {
        const data = await getToken();
        const cap = data.quality?.max_resolution;
        if (cap && cap in RESOLUTIONS) {
          shareCapRef.current = cap as ResolutionId;
          setShareCapState(cap as ResolutionId);
        }

        const r = new Room({
          adaptiveStream: true,
          dynacast: true,
          audioCaptureDefaults: { echoCancellation: true, noiseSuppression: opts.noiseSuppression ?? true, autoGainControl: true },
          videoCaptureDefaults: { resolution: VideoPresets.h720.resolution },
          publishDefaults: { videoCodec: "vp8", simulcast: true, dtx: true, red: true },
        });
        roomRef.current = r;

        const events = [
          RoomEvent.ParticipantConnected,
          RoomEvent.ParticipantDisconnected,
          RoomEvent.TrackSubscribed,
          RoomEvent.TrackUnsubscribed,
          RoomEvent.TrackMuted,
          RoomEvent.TrackUnmuted,
          RoomEvent.TrackPublished,
          RoomEvent.TrackUnpublished,
          RoomEvent.LocalTrackPublished,
          RoomEvent.LocalTrackUnpublished,
          RoomEvent.ActiveSpeakersChanged,
          RoomEvent.ParticipantNameChanged,
        ] as const;
        for (const ev of events) r.on(ev, refresh);
        r.on(RoomEvent.ParticipantConnected, (p) => {
          if (!opts.quiet) flash(`${p.name || "Alguém"} entrou na sala`);
          opts.onPeerJoin?.(p.name || "Alguém", parseMeta(p.metadata));
        });
        r.on(RoomEvent.ParticipantDisconnected, (p) => {
          if (!opts.quiet) flash(`${p.name || "Alguém"} saiu da sala`);
          opts.onPeerLeave?.(p.name || "Alguém");
        });
        r.on(RoomEvent.ParticipantMetadataChanged, refresh);
        r.on(RoomEvent.AudioPlaybackStatusChanged, () => setCanPlayAudio(r.canPlaybackAudio));
        r.on(RoomEvent.ConnectionStateChanged, (s) => {
          if (s === ConnectionState.Reconnecting || s === ConnectionState.SignalReconnecting) setStatus("reconnecting");
          else if (s === ConnectionState.Connected) setStatus("connected");
        });
        r.on(RoomEvent.Disconnected, (reason?: DisconnectReason) => {
          screenTracks.current = [];
          setSharing(null);
          // solta a sala: sem isso, depois de cair (ex.: entrou pelo celular) não dava para entrar de novo sem reiniciar
          if (roomRef.current === r) {
            roomRef.current = null;
            detRef.current?.close();
            detRef.current = null;
            setRoom(null);
            setPeers([]);
          }
          if (reason === DisconnectReason.DUPLICATE_IDENTITY) {
            setEndReason("elsewhere");
          } else if (reason === DisconnectReason.PARTICIPANT_REMOVED) {
            setEndReason("removed");
          }
          const dropped = problemFromDisconnect(reason);
          if (dropped) setProblem(dropped);
          setStatus((st) => (st === "error" ? st : "disconnected"));
        });

        await r.connect(data.url, data.token);
        setRoom(r);
        setStatus("connected");
        setCanPlayAudio(r.canPlaybackAudio);
        refresh();

        if (opts.mic) {
          try {
            await r.localParticipant.setMicrophoneEnabled(true);
          } catch (e) {
            flash(describeMediaError(e, "o microfone"));
          }
        }
        if (opts.camera) {
          try {
            await r.localParticipant.setCameraEnabled(true);
          } catch (e) {
            flash(describeMediaError(e, "a câmera"));
          }
        }
        refresh();
        return true;
      } catch (e) {
        roomRef.current?.disconnect();
        roomRef.current = null;
        setRoom(null);
        setStatus("error");
        const p = problemFromError(e);
        setProblem(p);
        setError(p.text);
        return false;
      }
    },
    [flash, refresh],
  );

  const leave = useCallback(async () => {
    await stopShare();
    await roomRef.current?.disconnect();
    roomRef.current = null;
    stopDetector();
    setRoom(null);
    setPeers([]);
    setStatus("disconnected");
  }, [stopShare, stopDetector]);

  // no celular (app ou navegador), a tela não apaga enquanto estiver na call
  const inCall = status === "connected" || status === "reconnecting" || status === "connecting";
  useEffect(() => {
    if (!inCall) return;
    const bridge = (window as unknown as { cdgAndroid?: { emCall(on: boolean): void } }).cdgAndroid;
    bridge?.emCall(true);
    let lock: WakeLockSentinel | null = null;
    let dead = false;
    const grab = () => {
      if (dead || document.visibilityState !== "visible" || !("wakeLock" in navigator)) return;
      navigator.wakeLock
        .request("screen")
        .then((l) => (dead ? void l.release() : (lock = l)))
        .catch(() => {});
    };
    grab();
    document.addEventListener("visibilitychange", grab);
    return () => {
      dead = true;
      document.removeEventListener("visibilitychange", grab);
      void lock?.release().catch(() => {});
      bridge?.emCall(false);
    };
  }, [inCall]);

  // sai da sala ao fechar a página
  useEffect(() => {
    return () => {
      roomRef.current?.disconnect();
      roomRef.current = null;
    };
  }, []);

  const toggleMic = useCallback(async () => {
    const r = roomRef.current;
    if (!r) return;
    try {
      await r.localParticipant.setMicrophoneEnabled(!r.localParticipant.isMicrophoneEnabled);
    } catch (e) {
      flash(describeMediaError(e, "o microfone"));
    }
    refresh();
  }, [flash, refresh]);

  /** Liga/desliga o microfone direto (usado pelo apertar-para-falar). */
  const setMic = useCallback(
    async (on: boolean) => {
      const r = roomRef.current;
      if (!r || r.localParticipant.isMicrophoneEnabled === on) return;
      try {
        await r.localParticipant.setMicrophoneEnabled(on);
      } catch (e) {
        flash(describeMediaError(e, "o microfone"));
      }
      refresh();
    },
    [flash, refresh],
  );

  /** Troca a redução de ruído do navegador sem sair da call. */
  const setNoiseSuppression = useCallback(async (on: boolean) => {
    const r = roomRef.current;
    if (!r) return;
    r.options.audioCaptureDefaults = { ...r.options.audioCaptureDefaults, noiseSuppression: on };
    const pub = r.localParticipant.getTrackPublication(Track.Source.Microphone);
    const track = pub?.track as LocalAudioTrack | undefined;
    if (track) await track.restartTrack({ noiseSuppression: on, echoCancellation: true, autoGainControl: true }).catch(() => {});
  }, []);

  const toggleCamera = useCallback(async () => {
    const r = roomRef.current;
    if (!r) return;
    try {
      await r.localParticipant.setCameraEnabled(!r.localParticipant.isCameraEnabled);
    } catch (e) {
      flash(describeMediaError(e, "a câmera"));
    }
    refresh();
  }, [flash, refresh]);

  const startShare = useCallback(
    async (s: ShareSettings) => {
      const r = roomRef.current;
      if (!r) return;
      if (screenTracks.current.length) await stopShare();
      const capped = clampResolution(s.resolution, shareCapRef.current);
      if (capped !== s.resolution) {
        flash(`O servidor está cheio agora: a tela vai em ${RESOLUTIONS[capped].label}.`);
        s = { ...s, resolution: capped };
      }
      const res = RESOLUTIONS[s.resolution];
      let tracks: LocalTrack[];
      try {
        tracks = await r.localParticipant.createScreenTracks({
          // áudio da aba/sistema sem os filtros de voz, para música e efeitos saírem limpos.
          // restrictOwnAudio tira do som do PC o que o próprio Call dos Games toca (as vozes da call),
          // senão quem fala escuta a própria voz de volta pelo compartilhamento (eco).
          audio: s.audio
            ? ({ echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 2, ...OWN_AUDIO_OFF } as AudioCaptureOptions)
            : false,
          resolution: { width: res.width, height: res.height, frameRate: s.fps },
          contentHint: "motion",
          selfBrowserSurface: "exclude",
          surfaceSwitching: "include",
          systemAudio: "include",
        });
      } catch (e) {
        const name = e instanceof Error ? e.name : "";
        if (name !== "NotAllowedError" && name !== "AbortError") flash("Não foi possível compartilhar a tela.");
        return;
      }

      const encoding = { maxBitrate: bitrateFor(s.resolution, s.fps), maxFramerate: s.fps, priority: "high" as const };
      try {
        for (const t of tracks) {
          if (t.kind === Track.Kind.Video) {
            await r.localParticipant.publishTrack(t, {
              source: Track.Source.ScreenShare,
              videoCodec: s.codec,
              backupCodec: s.codec === "vp8" ? false : { codec: "vp8" },
              simulcast: false,
              screenShareEncoding: encoding,
              videoEncoding: encoding,
              // jogo: segura os fps; vídeo/anime: segura a nitidez
              degradationPreference: s.mode === "game" ? "maintain-framerate" : "maintain-resolution",
            });
          } else {
            await r.localParticipant.publishTrack(t, {
              source: Track.Source.ScreenShareAudio,
              audioPreset: AudioPresets.musicHighQualityStereo,
              dtx: false,
              red: false,
              forceStereo: true,
            });
          }
          // quando a pessoa clica em "Parar de compartilhar" na barra do navegador
          t.once(TrackEvent.Ended, () => void stopShare());
        }
      } catch {
        tracks.forEach((t) => t.stop());
        flash("O servidor recusou o compartilhamento. Tente outro codec ou uma resolução menor.");
        return;
      }
      screenTracks.current = tracks;
      setSharing(s);
      if (s.audio && !tracks.some((t) => t.kind === Track.Kind.Audio)) {
        flash("Tela compartilhada sem som. Para ter áudio, marque “Compartilhar áudio” na janela do navegador.");
      }
      refresh();
    },
    [flash, refresh, stopShare],
  );

  /**
   * Novo limite do servidor. Se a tela estiver indo acima dele, baixa na hora, sem parar a transmissão
   * (troca o tamanho capturado e o bitrate do envio).
   */
  const setShareCap = useCallback(
    async (cap: ResolutionId) => {
      shareCapRef.current = cap;
      setShareCapState(cap);
      const cur = sharingRef.current;
      if (!cur || !aboveCap(cur.resolution, cap)) return;
      const video = screenTracks.current.find((t) => t.kind === Track.Kind.Video);
      if (!video) return;
      const res = RESOLUTIONS[cap];
      try {
        await video.mediaStreamTrack.applyConstraints({ width: { max: res.width }, height: { max: res.height }, frameRate: cur.fps });
        const sender = video.sender;
        if (sender) {
          const params = sender.getParameters();
          for (const e of params.encodings ?? []) e.maxBitrate = bitrateFor(cap, cur.fps);
          await sender.setParameters(params);
        }
      } catch {
        /* o navegador não deixou mudar: segue como estava */
        return;
      }
      setSharing({ ...cur, resolution: cap });
      flash(`O servidor ficou cheio: sua tela baixou para ${res.label} para ninguém travar.`);
    },
    [flash],
  );

  const startAudio = useCallback(async () => {
    await roomRef.current?.startAudio();
    setCanPlayAudio(true);
  }, []);

  return {
    room,
    status,
    endReason,
    problem,
    error,
    notice,
    flash,
    peers,
    canPlayAudio,
    sharing,
    shareCap,
    setShareCap,
    join,
    leave,
    toggleMic,
    setMic,
    setNoiseSuppression,
    toggleCamera,
    startShare,
    stopShare,
    startAudio,
  };
}

export type Call = ReturnType<typeof useCall>;
