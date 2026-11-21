"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Dices,
  Eraser,
  Headphones,
  HeadphoneOff,
  Maximize2,
  MessageSquare,
  Minimize2,
  Mic,
  MicOff,
  MonitorOff,
  MonitorUp,
  Music2,
  PenLine,
  PhoneOff,
  PictureInPicture2,
  Scissors,
  Settings2,
  Smile,
  Sparkles,
  TvMinimalPlay,
  WifiOff,
  Video,
  VideoOff,
  Volume2,
  VolumeX,
} from "lucide-react";
import { isUnread, nameInChannel, useNameInServer, useStore, useUser } from "@/lib/store";
import { openModal, openUserMenu, toast, toggleUI, useUI } from "@/lib/ui";
import { useVoice, type Spin, type Stroke } from "@/lib/voice";
import { hitByEraser } from "@/lib/board";
import { DEFAULT_SHARE, RESOLUTIONS, type Peer, type ShareSettings } from "@/lib/use-call";
import type { CallProblem } from "@/lib/call-errors";
import { loadJSON, saveJSON } from "@/lib/prefs";
import { durationOf } from "@/lib/format";
import type { Channel, Server, Sound } from "@/lib/types";
import { TrackVideo, useTicker } from "@/components/room/media";
import { ScreenStage } from "@/components/room/screen-stage";
import { useCallViewMounted, YtSlot } from "./music-player";
import { DevicesPanel, SharePanel } from "@/components/room/panels";
import { Avatar } from "./bits";
import { QueuePanel } from "./queue-panel";
import { CallChat } from "./chat";
import { HypeButton } from "./hype";

/* ------------------------------------------------------------------ */
/* página de um canal de voz                                           */
/* ------------------------------------------------------------------ */

export function VoiceView({ channel, server }: { channel: Channel; server: Server }) {
  const v = useVoice();
  const here = v.channelId === channel.id;
  const inside = useStore((s) => s.voice[channel.id]) ?? [];
  const livekit = useStore((s) => s.livekit);
  const chatOpen = useUI((s) => s.callChat);
  const focus = useUI((s) => s.focus);
  const unread = useStore((s) => isUnread(channel.id, channel.last_message_id, s.reads));
  useTicker(1000, inside.length > 0 && !here);

  // Esc sai do modo foco
  useEffect(() => {
    if (!focus) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !useUI.getState().modal && toggleUI("focus");
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [focus]);

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-cocoa-1">
      <header className="flex h-12 shrink-0 items-center gap-2.5 border-b border-cocoa-0/60 px-3 sm:px-4">
        <button type="button" onClick={() => useUI.setState({ navOpen: true })} className="press -ml-1 rounded-md p-1.5 text-oat/60 md:hidden" aria-label="Abrir menu">
          <Volume2 className="size-5" />
        </button>
        <Volume2 className="hidden size-5 text-oat/40 md:block" />
        <h1 className="font-semibold">{channel.name}</h1>
        {here && <span className="live-dot ml-1 !bg-moss" />}
        <div className="ml-auto flex items-center gap-1">
          <HypeButton channelId={channel.id} compact />
          <button
            type="button"
            onClick={() => toggleUI("callChat")}
            aria-pressed={chatOpen}
            title={chatOpen ? "Fechar o chat da call" : "Abrir o chat da call"}
            aria-label={chatOpen ? "Fechar o chat da call" : "Abrir o chat da call"}
            className={`press relative flex h-8 items-center gap-1.5 rounded-[9px] px-2.5 text-[13px] font-semibold ${chatOpen ? "bg-cocoa-4 text-oat" : "text-oat/60 hover:bg-cocoa-4 hover:text-oat"}`}
          >
            <MessageSquare className="size-4" />
            <span className="hidden sm:inline">Chat</span>
            {unread && !chatOpen && <span className="absolute right-1 top-1 size-2 rounded-full bg-rust" aria-label="mensagens novas" />}
          </button>
          <button
            type="button"
            onClick={() => toggleUI("focus")}
            aria-pressed={focus}
            title={focus ? "Mostrar servidores e canais (Esc)" : "Esconder servidores e canais"}
            aria-label={focus ? "Mostrar servidores e canais" : "Esconder servidores e canais"}
            className="press hidden size-8 place-items-center rounded-[9px] text-oat/60 hover:bg-cocoa-4 hover:text-oat md:grid"
          >
            {focus ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
          </button>
        </div>
      </header>

      <div className="relative flex min-h-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col">
      {here ? (
        <CallStage server={server} strip={chatOpen} />
      ) : (
        <div className="grid flex-1 place-items-center overflow-y-auto p-6">
          <div className="w-full max-w-md text-center">
            <p className="label text-ember">{server.name}</p>
            <h2 className="mt-3 font-display text-[clamp(40px,6vw,64px)] leading-[0.98]">{channel.name}</h2>
            {inside.length > 0 ? (
              <>
                <div className="mt-6 flex justify-center -space-x-3">
                  {inside.slice(0, 7).map((m) => (
                    <InsideAvatar key={m.user_id} id={m.user_id} />
                  ))}
                </div>
                <p className="mt-3 text-[14.5px] text-oat/60">
                  {inside.length === 1 ? "1 pessoa" : `${inside.length} pessoas`} aqui, faz {durationOf(Date.now() - Math.min(...inside.map((m) => m.since)))}.
                </p>
              </>
            ) : (
              <p className="mt-4 text-[15px] text-oat/50">Ninguém por aqui ainda. Entra e chama a turma.</p>
            )}
            {!livekit && (
              <p className="mt-5 rounded-[12px] bg-honey/15 px-4 py-3 text-[13.5px] text-honey">
                O servidor de voz ainda não foi configurado (LIVEKIT_URL, LIVEKIT_API_KEY e LIVEKIT_API_SECRET no backend).
              </p>
            )}
            {v.call.problem && (v.call.status === "error" || v.call.status === "disconnected") && (
              <CallProblemCard problem={v.call.problem} busy={!!v.joining} onRetry={v.call.problem.retry && livekit ? () => void v.join(channel.id) : undefined} />
            )}
            <button type="button" disabled={!!v.joining || !livekit} onClick={() => void v.join(channel.id)} className="btn-ember mt-7 h-12 px-8 text-[16px]">
              {v.joining === channel.id ? "Conectando…" : v.channelId ? "Trocar para esta call" : "Entrar na call"}
            </button>
            <p className="mt-3 text-[12.5px] text-oat/40">{v.prefs.ptt ? "Você entra com apertar-para-falar." : v.prefs.startMuted ? "Você entra mutado." : "Você entra com o microfone ligado."}</p>
          </div>
        </div>
      )}
      </div>
      {chatOpen && (
        <aside
          aria-label={`Chat de ${channel.name}`}
          className="absolute inset-y-0 right-0 z-20 flex w-full max-w-[360px] flex-col border-l border-cocoa-0/60 bg-cocoa-3 shadow-2xl lg:static lg:w-[340px] lg:shadow-none xl:w-[380px] xl:max-w-none"
        >
          <CallChat channel={channel} server={server} />
        </aside>
      )}
      </div>
    </div>
  );
}

function InsideAvatar({ id }: { id: string }) {
  const u = useUser(id);
  if (!u) return null;
  return (
    <span className="rounded-full ring-4 ring-cocoa-1">
      <Avatar name={u.display_name} avatar={u.avatar} accent={u.accent} size={52} />
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* palco da call (usado no canal de voz e na chamada de conversa)      */
/* ------------------------------------------------------------------ */

type Dock = "share" | "yt" | "devices" | "fun" | "sounds" | "react" | null;

/**
 * O palco é desmontado quando você sai da tela da call (vai ler o chat, por exemplo).
 * Aqui fica o que estava aberto em cada call, para voltar do mesmo jeito.
 */
interface StageMemo {
  pinned: string | null;
  board: boolean;
  roll: boolean;
  spin: string | null;
  strokes: number;
}
const NO_SHARE = "Sua tela e câmera estão limitadas neste servidor (passou do limite de uso ou um admin restringiu). O microfone continua normal.";

const stageMemo = new Map<string, StageMemo>();
/** Roleta girada há mais tempo que isso não abre sozinha quando você volta para a call. */
const FRESH_SPIN_MS = 12_000;

/** strip: a turma fica numa faixa embaixo do palco (quando o chat da call ocupa a lateral). */
export function CallStage({ server, compact, strip }: { server?: Server; compact?: boolean; strip?: boolean }) {
  useCallViewMounted();
  const v = useVoice();
  const { call, yt } = v;
  const livekitCloud = useStore((s) => s.livekitCloud);
  const memoKey = v.channelId ?? "";
  // o que já foi visto: roleta antiga e desenhos antigos não abrem nada de novo
  const [init] = useState<StageMemo>(
    () =>
      stageMemo.get(memoKey) ?? {
        pinned: null,
        board: false,
        roll: false,
        spin: v.spin && Date.now() - v.spin.at > FRESH_SPIN_MS ? v.spin.id : null,
        strokes: v.strokes.length,
      },
  );
  const [dock, setDock] = useState<Dock>(null);
  const [pinned, setPinned] = useState<string | null>(init.pinned);
  const [share, setShare] = useState<ShareSettings>(DEFAULT_SHARE);
  const [boardOpen, setBoardOpen] = useState(init.board);
  const [rollOpen, setRollOpen] = useState(init.roll);
  const lastSpin = useRef<string | null>(init.spin);
  const seenStrokes = useRef(init.strokes);

  useEffect(() => {
    stageMemo.set(memoKey, { pinned, board: boardOpen, roll: rollOpen, spin: lastSpin.current, strokes: seenStrokes.current });
  });

  useEffect(() => setShare(loadJSON("share", DEFAULT_SHARE)), []);

  // Alt+C: clipa o lance
  const clipSave = v.clip.available && !v.clip.busy ? v.clip.save : null;
  useEffect(() => {
    if (!clipSave) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey && e.code === "KeyC" && !e.repeat) {
        e.preventDefault();
        void clipSave();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [clipSave]);

  // roleta nova chegou: todo mundo vê girar
  useEffect(() => {
    if (v.spin && v.spin.id !== lastSpin.current) {
      lastSpin.current = v.spin.id;
      setRollOpen(true);
      setPinned("roll");
    }
  }, [v.spin]);
  // alguém desenhou algo novo: abre o quadro
  useEffect(() => {
    const n = v.strokes.length;
    if (n > seenStrokes.current && !boardOpen) setBoardOpen(true);
    seenStrokes.current = n;
  }, [v.strokes.length, boardOpen]);

  const me = call.peers.find((p) => p.isLocal);
  const screens = call.peers.filter((p) => p.screen);
  const options = [
    ...(yt.state ? [{ id: "yt", label: "YouTube" }] : []),
    ...screens.map((p) => ({ id: `s:${p.identity}`, label: p.isLocal ? "Sua tela" : `Tela de ${nameInChannel(v.channelId, p.identity, p.name)}` })),
    ...(boardOpen ? [{ id: "board", label: "Quadro" }] : []),
    ...(rollOpen ? [{ id: "roll", label: "Roleta" }] : []),
  ];
  const auto = yt.state ? "yt" : screens.length ? `s:${(screens.find((p) => !p.isLocal) ?? screens[0]).identity}` : boardOpen ? "board" : rollOpen ? "roll" : null;
  // "grid" = a turma em grade, mesmo com tela, vídeo ou atividade aberta
  const stage = pinned === "grid" ? null : pinned && options.some((o) => o.id === pinned) ? pinned : auto;
  const tabs = options.length ? [{ id: "grid", label: "Pessoas" }, ...options] : [];
  const current = stage ?? "grid";
  const stagePeer = stage?.startsWith("s:") ? screens.find((p) => `s:${p.identity}` === stage) : undefined;

  // na call de conversa privada não tem servidor: usa os sons de todos os seus servidores.
  // O seletor devolve só a referência estável; a lista nova sai do useMemo (senão o zustand
  // vê "mudou" a cada leitura e o React entra em loop: erro #185, a página não carrega).
  const allServers = useStore((s) => (server ? null : s.servers));
  const sounds = useMemo(() => (server ? server.sounds : Object.values(allServers ?? {}).flatMap((x) => x.sounds)), [server, allServers]);

  const n = call.peers.length;
  const cols = n <= 1 ? 1 : n <= 4 ? 2 : n <= 9 ? 3 : 4;
  const rows = Math.ceil(n / cols);
  const solo = n === 1 && !compact;
  const toggle = (d: Dock) => setDock((cur) => (cur === d ? null : d));

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      {tabs.length > 0 && (
        <div className={`flex shrink-0 gap-1 overflow-x-auto ${compact ? "px-2 pt-2" : "px-3 pt-3 sm:px-4"}`} role="tablist" aria-label="O que mostrar">
          {tabs.map((o) => (
            <button
              key={o.id}
              type="button"
              role="tab"
              aria-selected={o.id === current}
              onClick={() => setPinned(o.id)}
              className={`press shrink-0 rounded-full px-3 py-1 text-[13px] font-semibold ${o.id === current ? "bg-oat text-cocoa-0" : "text-oat/55 hover:bg-cocoa-4 hover:text-oat"}`}
            >
              {o.label}
            </button>
          ))}
        </div>
      )}
      <div className={`flex min-h-0 flex-1 flex-col gap-3 ${compact ? "p-2" : "p-3 sm:p-4"} ${strip ? "" : "lg:flex-row"}`}>
        {stage ? (
          <>
            <section className="flex min-h-0 min-w-0 flex-1 flex-col">
              <div className="relative min-h-0 flex-1 overflow-hidden rounded-[16px] bg-cocoa-0">
                {/* o player de verdade fica fixo na página (music-player.tsx) e se encaixa aqui */}
                {stage === "yt" && <YtSlot className="absolute inset-0" />}
                {stagePeer && (
                  <div className="absolute inset-0">
                    <ScreenStage peer={stagePeer} volume={v.screenVol[stagePeer.identity] ?? 1} onVolume={(x) => v.setScreenVol(stagePeer.identity, x)} />
                    <PipButton />
                  </div>
                )}
                {stage === "board" && <Whiteboard onClose={() => (setBoardOpen(false), setPinned(null))} />}
                {stage === "roll" && <Roulette spin={v.spin} onClose={() => (setRollOpen(false), setPinned(null))} />}
              </div>
            </section>
            <aside
              aria-label="Pessoas na call"
              className={
                strip
                  ? "flex h-24 shrink-0 gap-2 overflow-x-auto sm:h-28 [&>*]:w-40 [&>*]:shrink-0 sm:[&>*]:w-44"
                  : "flex h-24 shrink-0 gap-2 overflow-x-auto sm:h-28 lg:h-auto lg:w-56 lg:flex-col lg:overflow-y-auto lg:overflow-x-hidden xl:w-64 [&>*]:w-40 [&>*]:shrink-0 sm:[&>*]:w-44 lg:[&>*]:w-full"
              }
            >
              {call.peers.map((p) => (
                <Tile key={p.identity} peer={p} compact serverId={server?.id} />
              ))}
            </aside>
          </>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col items-center justify-center overflow-y-auto">
            <div
              className="grid w-full gap-3"
              style={{
                gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
                // sozinho: o quadro fica menor para o "chamar a turma" caber acima dos botões da call
                maxWidth: solo ? "min(100%, 760px, calc((100svh - 330px) * 16 / 9))" : `min(100%, calc((100svh - 220px) / ${rows} * 16 / 9 * ${cols}))`,
              }}
            >
              {call.peers.map((p) => (
                <Tile key={p.identity} peer={p} serverId={server?.id} />
              ))}
            </div>
            {solo && (
              <div className="mt-4 flex shrink-0 flex-wrap items-center justify-center gap-x-4 gap-y-2 text-center text-[14px] text-oat/45">
                <p>Só você por enquanto.</p>
                {server && v.channelId && (
                  <>
                    <HypeButton channelId={v.channelId} />
                    <button type="button" onClick={() => openModal({ kind: "invite", serverId: server.id })} className="text-[13px] font-semibold text-ember-2 hover:underline">
                      Convidar alguém novo
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* reações e sons subindo pela tela */}
      <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-20 top-0 overflow-hidden">
        {v.reactions.map((r) => (
          <span key={r.id} className="float-up absolute bottom-0 flex flex-col items-center" style={{ left: `${r.x}%` }}>
            <span className="text-[38px] leading-none">{r.emoji}</span>
            <span className="mt-1 rounded-full bg-cocoa-0/80 px-2 py-0.5 text-[11px] font-semibold text-oat/80">{r.name}</span>
          </span>
        ))}
      </div>

      {/* dock */}
      <footer className="relative flex h-[68px] shrink-0 items-center justify-center gap-1 border-t border-cocoa-0/60 px-2 sm:gap-1.5">
        {dock && (
          <div className="absolute bottom-full left-1/2 z-30 mb-2 -translate-x-1/2">
            {dock === "share" && (
              <SharePanel
                initial={share}
                viewers={n - 1}
                freeTier={livekitCloud}
                maxResolution={call.shareCap}
                clipOnly={
                  v.prefs.clipBuffer && v.clip.supported
                    ? {
                        on: v.clip.ownScreen,
                        toggle: () => {
                          setDock(null);
                          void v.clip.toggleOwnScreen();
                        },
                      }
                    : undefined
                }
                onClose={() => setDock(null)}
                onStart={(s) => {
                  setShare(s);
                  saveJSON("share", s);
                  setDock(null);
                  void call.startShare(s);
                }}
              />
            )}
            {dock === "yt" && <QueuePanel onClose={() => setDock(null)} onPlaying={() => setPinned("yt")} />}
            {dock === "devices" && call.room && <DevicesPanel room={call.room} onClose={() => setDock(null)} />}
            {dock === "fun" && (
              <FunPanel
                onPick={(what) => {
                  setDock(what === "yt" ? "yt" : null);
                  if (what === "board") {
                    setBoardOpen(true);
                    setPinned("board");
                  }
                  if (what === "roll") {
                    setRollOpen(true);
                    setPinned("roll");
                  }
                }}
              />
            )}
            {dock === "sounds" && <SoundPanel sounds={sounds} serverId={server?.id} onPlay={v.playSound} />}
            {dock === "react" && <ReactPanel onPick={(e) => v.react(e)} />}
          </div>
        )}

        <DockButton label={v.prefs.ptt ? "Apertar para falar" : me?.micOn ? "Desligar microfone" : "Ligar microfone"} off={!me?.micOn && !v.prefs.ptt} onClick={() => !v.prefs.ptt && void call.toggleMic()}>
          {me?.micOn || v.prefs.ptt ? <Mic /> : <MicOff />}
        </DockButton>
        <DockButton label={v.deaf ? "Voltar a ouvir" : "Silenciar tudo"} off={v.deaf} onClick={() => v.setDeaf(!v.deaf)}>
          {v.deaf ? <HeadphoneOff /> : <Headphones />}
        </DockButton>
        <DockButton
          label={v.noShare ? "Câmera limitada neste servidor" : me?.camera ? "Desligar câmera" : "Ligar câmera"}
          off={!me?.camera}
          onClick={() => (v.noShare ? toast(NO_SHARE) : void call.toggleCamera())}
        >
          {me?.camera ? <Video /> : <VideoOff />}
        </DockButton>
        <span className="mx-1 h-7 w-px bg-oat/10" />
        {call.sharing ? (
          <DockButton label="Parar de transmitir" active onClick={() => void call.stopShare()}>
            <MonitorOff />
          </DockButton>
        ) : (
          <DockButton
            label={v.noShare ? "Transmissão limitada neste servidor" : "Compartilhar tela"}
            open={dock === "share"}
            onClick={() => (v.noShare ? toast(NO_SHARE) : toggle("share"))}
          >
            <MonitorUp />
          </DockButton>
        )}
        {v.clip.available && (
          <DockButton
            label={
              v.clip.busy
                ? "Salvando clipe…"
                : v.clip.kind === "audio"
                  ? `Clipar o áudio dos últimos segundos (Alt+C)`
                  : `Clipar os últimos segundos${v.clip.ownScreen ? " da sua tela" : ""} (Alt+C)`
            }
            active={v.clip.busy}
            onClick={() => !v.clip.busy && void v.clip.save()}
            className="relative"
          >
            <Scissors />
            {v.clip.ownScreen && <span aria-hidden className="absolute right-1.5 top-1.5 size-2 rounded-full bg-rust" />}
          </DockButton>
        )}
        <DockButton label="Atividades" open={dock === "fun"} onClick={() => toggle("fun")}>
          <Sparkles />
        </DockButton>
        {(yt.state || v.queue.length > 0) && (
          <DockButton label={`YouTube e fila${v.queue.length ? ` (${v.queue.length})` : ""}`} open={dock === "yt"} onClick={() => toggle("yt")} className="relative hidden sm:grid">
            <TvMinimalPlay />
            {v.queue.length > 0 && (
              <span className="absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-ember px-1 text-[10px] font-bold text-white">{v.queue.length}</span>
            )}
          </DockButton>
        )}
        <DockButton label="Soundboard" open={dock === "sounds"} onClick={() => toggle("sounds")}>
          <Music2 />
        </DockButton>
        <DockButton label="Reagir" open={dock === "react"} onClick={() => toggle("react")} className="hidden sm:grid">
          <Smile />
        </DockButton>
        <DockButton label="Dispositivos" open={dock === "devices"} onClick={() => toggle("devices")} className="hidden sm:grid">
          <Settings2 />
        </DockButton>
        <span className="mx-1 h-7 w-px bg-oat/10" />
        <button type="button" onClick={() => void v.leave()} aria-label="Sair da call" title="Sair da call" className="press grid h-11 w-14 place-items-center rounded-[14px] bg-rust text-oat hover:brightness-110">
          <PhoneOff className="size-5" />
        </button>

        {call.sharing && (
          <span className="absolute right-4 hidden text-[12px] font-semibold text-ember-2 xl:block">
            Transmitindo {RESOLUTIONS[call.sharing.resolution].label} · {call.sharing.fps} fps
          </span>
        )}
      </footer>

      {!call.canPlayAudio && (
        <button type="button" onClick={call.startAudio} className="press slide-in absolute left-4 top-4 z-40 rounded-[12px] bg-oat px-4 py-3 text-left text-[13.5px] font-semibold text-cocoa-0">
          O navegador bloqueou o som. Clique aqui para ouvir a call.
        </button>
      )}
      {call.notice && (
        <div role="status" key={call.notice} className="slide-in pointer-events-none absolute bottom-[80px] left-4 z-40 max-w-md rounded-[12px] bg-oat px-4 py-2.5 text-[13.5px] text-cocoa-0">
          {call.notice}
        </div>
      )}
    </div>
  );
}

function DockButton({
  label,
  onClick,
  off,
  active,
  open,
  className = "grid",
  children,
}: {
  label: string;
  onClick: () => void;
  off?: boolean;
  active?: boolean;
  open?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      aria-pressed={off === undefined ? undefined : !off}
      aria-expanded={open}
      className={`press size-11 shrink-0 place-items-center rounded-[14px] [&_svg]:size-5 ${className} ${
        active ? "bg-ember text-white" : off ? "bg-rust/15 text-rust hover:bg-rust/25" : open ? "bg-oat text-white" : "bg-cocoa-3 text-oat hover:bg-cocoa-4"
      }`}
    >
      {children}
    </button>
  );
}

/** Abre a tela compartilhada numa janelinha flutuante, para continuar vendo enquanto joga ou conversa. */
function PipButton() {
  if (typeof document !== "undefined" && !document.pictureInPictureEnabled) return null;
  return (
    <button
      type="button"
      onClick={(e) => {
        const video = e.currentTarget.parentElement?.querySelector("video");
        if (video) void video.requestPictureInPicture().catch(() => {});
      }}
      className="press absolute right-3 top-3 z-10 flex items-center gap-1.5 rounded-full bg-cocoa-0/80 px-3 py-1.5 text-[12px] font-semibold text-oat hover:bg-cocoa-0"
      title="Janela flutuante"
    >
      <PictureInPicture2 className="size-3.5" /> Flutuante
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* quadradinho de cada pessoa                                          */
/* ------------------------------------------------------------------ */

function Tile({ peer, compact, serverId }: { peer: Peer; compact?: boolean; serverId?: string }) {
  const v = useVoice();
  const user = useUser(peer.identity);
  const name = useNameInServer(serverId, peer.identity, peer.name);
  const avatar = user?.avatar ?? peer.meta.avatar ?? null;
  const accent = user?.accent ?? peer.meta.accent ?? "#5865f2";
  const vol = v.voiceVol[peer.identity] ?? 1;
  const state = useStore((s) => (v.channelId ? s.voice[v.channelId]?.find((m) => m.user_id === peer.identity) : undefined));
  return (
    <div
      onContextMenu={(e) => openUserMenu(e, peer.identity, serverId)}
      className={`group relative aspect-video overflow-hidden rounded-[16px] transition-shadow ${peer.speaking ? "shadow-[0_0_0_3px_var(--color-moss)]" : ""}`}
      style={{ background: `color-mix(in srgb, ${accent} 18%, var(--color-cocoa-3))` }}
    >
      {peer.camera ? (
        <TrackVideo track={peer.camera} mirror={peer.isLocal} className="size-full" />
      ) : (
        <div className="grid size-full place-items-center">
          <Avatar name={name} avatar={avatar} accent={accent} size={compact ? 44 : 84} play={peer.speaking} ring={peer.speaking ? "var(--color-moss)" : undefined} />
        </div>
      )}
      <div className="absolute bottom-2 left-2 flex max-w-[calc(100%-16px)] items-center gap-1.5 rounded-full bg-cocoa-0/75 px-2.5 py-1 text-[12.5px] font-semibold">
        {state?.smute ? (
          <MicOff className="size-3.5 shrink-0 text-honey" aria-label="Mutado por um admin" />
        ) : (
          !peer.micOn && <MicOff className="size-3.5 shrink-0 text-rust" />
        )}
        {!peer.isLocal && v.localMute[peer.identity] && <VolumeX className="size-3.5 shrink-0 text-oat/60" aria-label="Silenciado para você" />}
        <span className="truncate">{name}</span>
        {peer.isLocal && <span className="text-oat/45">(você)</span>}
        {peer.screen && <span className="rounded-[4px] bg-rust px-1 text-[9px] uppercase text-oat">ao vivo</span>}
      </div>
      {!peer.isLocal && !compact && (
        <label className="absolute right-2 top-2 hidden items-center gap-2 rounded-full bg-cocoa-0/80 px-2.5 py-1 group-hover:flex">
          <Volume2 className="size-3.5 text-oat/70" />
          <input
            type="range"
            className="range w-24 text-oat"
            min={0}
            max={1}
            step={0.05}
            value={vol}
            style={{ ["--fill" as string]: `${vol * 100}%` }}
            onChange={(e) => v.setVoiceVol(peer.identity, Number(e.target.value))}
            aria-label={`Volume de ${name}`}
          />
          <span className="w-8 text-right text-[11px] tabular-nums text-oat/60">{Math.round(vol * 100)}%</span>
        </label>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* painéis do dock                                                     */
/* ------------------------------------------------------------------ */

function Sheet({ title, children, wide }: { title: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className={`pop-in rounded-[18px] bg-cocoa-0 p-4 ${wide ? "w-[min(420px,calc(100vw-16px))]" : "w-[min(340px,calc(100vw-16px))]"}`}>
      <p className="label mb-3 text-ember">{title}</p>
      {children}
    </div>
  );
}

function FunPanel({ onPick }: { onPick: (what: "yt" | "board" | "roll") => void }) {
  const items = [
    { id: "yt" as const, icon: <TvMinimalPlay />, title: "YouTube junto", text: "Cada um no seu player, play e pause para todos. Com fila votada." },
    { id: "board" as const, icon: <PenLine />, title: "Quadro", text: "Rabisquem juntos: mapa do chefe, jogo da velha, arte duvidosa." },
    { id: "roll" as const, icon: <Dices />, title: "Roleta", text: "Qual anime hoje? Quem paga a pizza? A roleta decide." },
  ];
  return (
    <Sheet title="Atividades" wide>
      <div className="space-y-1.5">
        {items.map((i) => (
          <button key={i.id} type="button" onClick={() => onPick(i.id)} className="press flex w-full items-start gap-3 rounded-[14px] bg-cocoa-3 p-3 text-left hover:bg-cocoa-4">
            <span className="grid size-10 shrink-0 place-items-center rounded-[12px] bg-ember text-white [&_svg]:size-5">{i.icon}</span>
            <span>
              <span className="block font-display text-[18px] font-semibold leading-tight">{i.title}</span>
              <span className="text-[13px] text-oat/55">{i.text}</span>
            </span>
          </button>
        ))}
      </div>
    </Sheet>
  );
}

function SoundPanel({ sounds, serverId, onPlay }: { sounds: Sound[]; serverId?: string; onPlay: (s: Sound) => void }) {
  const [cool, setCool] = useState<string | null>(null);
  return (
    <Sheet title="Soundboard" wide>
      {sounds.length === 0 ? (
        <p className="text-[13.5px] text-oat/55">Ainda não tem som. Suba o primeiro nas configurações do servidor.</p>
      ) : (
        <div className="grid max-h-[300px] grid-cols-3 gap-1.5 overflow-y-auto">
          {sounds.map((s) => (
            <button
              key={s.id}
              type="button"
              disabled={cool === s.id}
              onClick={() => {
                onPlay(s);
                setCool(s.id);
                window.setTimeout(() => setCool(null), 1200);
              }}
              className="press flex flex-col items-center gap-1 rounded-[12px] bg-cocoa-3 px-2 py-2.5 hover:bg-cocoa-4 disabled:opacity-50"
            >
              <span className="text-[22px] leading-none">{s.emoji || "🔊"}</span>
              <span className="w-full truncate text-center text-[12px] font-semibold">{s.name}</span>
            </button>
          ))}
        </div>
      )}
      {serverId && (
        <button type="button" onClick={() => openModal({ kind: "server-settings", serverId, tab: "sons" })} className="link-u mt-3 text-[13px] text-oat/60 hover:text-oat">
          + Adicionar som
        </button>
      )}
    </Sheet>
  );
}

const REACTS = ["😂", "🔥", "❤️", "😱", "👏", "💀", "🎉", "😭", "👀", "🤡", "🫡", "🍿"];
function ReactPanel({ onPick }: { onPick: (e: string) => void }) {
  return (
    <Sheet title="Reagir">
      <div className="grid grid-cols-6 gap-1">
        {REACTS.map((e) => (
          <button key={e} type="button" onClick={() => onPick(e)} className="press grid aspect-square place-items-center rounded-[10px] text-[24px] hover:bg-cocoa-4">
            {e}
          </button>
        ))}
      </div>
    </Sheet>
  );
}

/* ------------------------------------------------------------------ */
/* quando a call não conecta ou cai                                    */
/* ------------------------------------------------------------------ */

function CallProblemCard({ problem, busy, onRetry }: { problem: CallProblem; busy: boolean; onRetry?: () => void }) {
  return (
    <div role="alert" className="glass enter-pop mt-6 flex items-start gap-3 rounded-[18px] px-4 py-3.5 text-left">
      <span className="grid size-10 shrink-0 place-items-center rounded-full bg-rust/20 text-[#ffb1b3]">
        <WifiOff className="size-[18px]" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[14.5px] font-semibold text-oat">{problem.title}</p>
        <p className="mt-0.5 text-[13px] leading-snug text-oat/65">{problem.text}</p>
        {onRetry && (
          <button type="button" disabled={busy} onClick={onRetry} className="press mt-2.5 rounded-full bg-oat/10 px-3 py-1.5 text-[12.5px] font-semibold text-oat hover:bg-oat/15 disabled:opacity-50">
            {busy ? "Conectando…" : "Tentar de novo"}
          </button>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* quadro compartilhado                                                */
/* ------------------------------------------------------------------ */

// cursor da borracha: um círculo do tamanho da área que ela apaga
const ERASER_CURSOR = `url("data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28"><circle cx="14" cy="14" r="11" fill="rgba(242,243,245,.18)" stroke="#f2f3f5" stroke-width="1.5"/></svg>')}") 14 14, cell`;

const INKS = ["#f2f3f5", "#5865f2", "#f0b232", "#23a55a", "#00a8fc", "#eb459e", "#111214"];

function Whiteboard({ onClose }: { onClose: () => void }) {
  const v = useVoice();
  const canvas = useRef<HTMLCanvasElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const [color, setColor] = useState(INKS[1]);
  const [size, setSize] = useState(4);
  const [tool, setTool] = useState<"pen" | "eraser">("pen");
  const current = useRef<Stroke | null>(null);
  const erasing = useRef(false);
  const ERASER = 0.022; // raio da borracha (fração da largura da lousa)
  const rub = (e: React.PointerEvent) => {
    const [x, y] = point(e);
    const ids = hitByEraser(v.strokes, x, y, ERASER, v.myId, v.boardLeader);
    if (ids.length) v.eraseStrokes(ids);
  };
  const mine = v.strokes.some((s) => s.by === v.myId);

  const draw = useMemo(
    () => (ctx: CanvasRenderingContext2D, s: Stroke, w: number, h: number) => {
      if (s.pts.length < 2) return;
      ctx.strokeStyle = s.color;
      ctx.lineWidth = s.size * (w / 1000);
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.beginPath();
      ctx.moveTo(s.pts[0] * w, s.pts[1] * h);
      for (let i = 2; i < s.pts.length; i += 2) ctx.lineTo(s.pts[i] * w, s.pts[i + 1] * h);
      if (s.pts.length === 2) ctx.lineTo(s.pts[0] * w + 0.1, s.pts[1] * h);
      ctx.stroke();
    },
    [],
  );

  const redraw = () => {
    const c = canvas.current;
    if (!c) return;
    const ctx = c.getContext("2d")!;
    ctx.clearRect(0, 0, c.width, c.height);
    for (const s of v.strokes) draw(ctx, s, c.width, c.height);
    if (current.current) draw(ctx, current.current, c.width, c.height);
  };

  useEffect(() => {
    const el = wrap.current;
    const c = canvas.current;
    if (!el || !c) return;
    const ro = new ResizeObserver(() => {
      const dpr = window.devicePixelRatio || 1;
      // mantém 16:9 para todo mundo ver o mesmo desenho
      const w = el.clientWidth;
      const h = Math.min(el.clientHeight, (w * 9) / 16);
      const ww = (h * 16) / 9;
      c.style.width = `${ww}px`;
      c.style.height = `${h}px`;
      c.width = Math.round(ww * dpr);
      c.height = Math.round(h * dpr);
      redraw();
    });
    ro.observe(el);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(redraw, [v.strokes]);

  const point = (e: React.PointerEvent) => {
    const r = canvas.current!.getBoundingClientRect();
    return [Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)), Math.max(0, Math.min(1, (e.clientY - r.top) / r.height))];
  };

  return (
    <div ref={wrap} className="absolute inset-0 grid place-items-center bg-cocoa-2">
      <canvas
        ref={canvas}
        className="touch-none rounded-[12px] bg-cocoa-3"
        style={{ cursor: tool === "eraser" ? ERASER_CURSOR : "crosshair", backgroundImage: "radial-gradient(color-mix(in srgb, var(--color-oat) 9%, transparent) 1px, transparent 1px)", backgroundSize: "22px 22px" }}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          if (tool === "eraser") {
            erasing.current = true;
            rub(e);
            return;
          }
          current.current = { id: Math.random().toString(36).slice(2), color, size, pts: point(e), by: v.myId };
          redraw();
        }}
        onPointerMove={(e) => {
          if (erasing.current) return rub(e);
          const s = current.current;
          if (!s) return;
          const [x, y] = point(e);
          const lx = s.pts[s.pts.length - 2];
          const ly = s.pts[s.pts.length - 1];
          if (Math.hypot(x - lx, y - ly) < 0.003 || s.pts.length > 1200) return;
          s.pts.push(Math.round(x * 10000) / 10000, Math.round(y * 10000) / 10000);
          redraw();
        }}
        onPointerUp={() => {
          erasing.current = false;
          const s = current.current;
          current.current = null;
          if (s) v.addStroke(s);
        }}
      />
      <div className="absolute left-1/2 top-3 flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-cocoa-0/90 px-2 py-1.5">
        {INKS.map((c) => (
          <button
            key={c}
            type="button"
            aria-label={`Cor ${c}`}
            onClick={() => (setColor(c), setTool("pen"))}
            className="press size-6 rounded-full"
            style={{ background: c, boxShadow: tool === "pen" && color === c ? "0 0 0 2px var(--color-cocoa-0), 0 0 0 4px var(--color-oat)" : undefined }}
          />
        ))}
        <span className="mx-1 h-5 w-px bg-oat/15" />
        {[3, 7, 14].map((s) => (
          <button key={s} type="button" aria-label={`Espessura ${s}`} onClick={() => (setSize(s), setTool("pen"))} className={`press grid size-7 place-items-center rounded-full ${tool === "pen" && size === s ? "bg-cocoa-4" : ""}`}>
            <span className="rounded-full bg-oat" style={{ width: s / 1.4 + 2, height: s / 1.4 + 2 }} />
          </button>
        ))}
        <span className="mx-1 h-5 w-px bg-oat/15" />
        <button
          type="button"
          aria-pressed={tool === "eraser"}
          onClick={() => setTool((t) => (t === "eraser" ? "pen" : "eraser"))}
          className={`press flex items-center gap-1 rounded-full px-2 py-1 text-[12px] font-semibold ${tool === "eraser" ? "bg-oat text-cocoa-0" : "text-oat/70 hover:text-oat"}`}
          title={v.boardLeader ? "Borracha (você lidera a call: apaga de qualquer um)" : "Borracha: apaga só o que você desenhou"}
        >
          <Eraser className="size-3.5" /> Borracha
        </button>
        <button
          type="button"
          disabled={!mine}
          onClick={() => v.clearBoard("mine")}
          className="press rounded-full px-2 py-1 text-[12px] font-semibold text-oat/70 hover:text-oat disabled:opacity-35"
          title="Apaga tudo o que você desenhou (o dos outros fica)"
        >
          Limpar o meu
        </button>
        {v.boardLeader && (
          <button
            type="button"
            disabled={!v.strokes.length}
            onClick={() => confirm("Limpar a lousa inteira, de todo mundo?") && v.clearBoard("all")}
            className="press rounded-full px-2 py-1 text-[12px] font-semibold text-[#ffb1b3] hover:text-[#ffd0d1] disabled:opacity-35"
            title="Você lidera a call: apaga o desenho de todo mundo"
          >
            Limpar tudo
          </button>
        )}
        <button type="button" onClick={onClose} className="press rounded-full px-2 py-1 text-[12px] font-semibold text-oat/50 hover:text-oat">
          Fechar
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* roleta                                                              */
/* ------------------------------------------------------------------ */

const WHEEL = ["#5865f2", "#27282c", "#f0b232", "#404249", "#23a55a", "#313238", "#eb459e", "#1f2023"];

function Roulette({ spin, onClose }: { spin: Spin | null; onClose: () => void }) {
  const v = useVoice();
  const [text, setText] = useState(() => {
    try {
      return localStorage.getItem("cdg:roleta") || "Frieren\nOne Piece\nJujutsu Kaisen\nDandadan\nSpy x Family";
    } catch {
      return "Frieren\nOne Piece\nJujutsu Kaisen";
    }
  });
  const [angle, setAngle] = useState(0);
  const [done, setDone] = useState(false);
  const options = spin?.options ?? text.split("\n").map((s) => s.trim()).filter(Boolean).slice(0, 16);
  const seg = 360 / Math.max(1, options.length);

  useEffect(() => {
    if (!spin) return;
    setDone(false);
    // gira várias voltas e para com o vencedor embaixo do ponteiro (no topo)
    const target = 360 * 7 + (360 - (spin.winner + 0.5) * (360 / spin.options.length));
    setAngle(0);
    const raf = requestAnimationFrame(() => requestAnimationFrame(() => setAngle(target)));
    const t = window.setTimeout(() => setDone(true), 4300);
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(t);
    };
  }, [spin]);

  const r = 140;
  const slices = options.map((label, i) => {
    const a0 = ((i * seg - 90) * Math.PI) / 180;
    const a1 = (((i + 1) * seg - 90) * Math.PI) / 180;
    const large = seg > 180 ? 1 : 0;
    const path = options.length === 1 ? `M ${r} 0 A ${r} ${r} 0 1 1 ${r - 0.01} 0 Z` : `M 0 0 L ${r * Math.cos(a0)} ${r * Math.sin(a0)} A ${r} ${r} 0 ${large} 1 ${r * Math.cos(a1)} ${r * Math.sin(a1)} Z`;
    const mid = (((i + 0.5) * seg - 90) * Math.PI) / 180;
    return { label, path, tx: Math.cos(mid) * r * 0.6, ty: Math.sin(mid) * r * 0.6, rot: (i + 0.5) * seg - 90, fill: WHEEL[i % WHEEL.length] };
  });

  return (
    // @container: a roda e as opções ficam lado a lado só quando o palco tem espaço (com o chat aberto ele encolhe)
    <div className="@container absolute inset-0 overflow-y-auto bg-cocoa-2">
      <div className="grid min-h-full grid-cols-1 place-items-center gap-6 p-6 @2xl:grid-cols-[1fr_260px]">
      <div className="relative mb-12">
        <span aria-hidden className="absolute left-1/2 top-[-6px] z-10 -translate-x-1/2 text-[26px] leading-none text-oat drop-shadow">
          ▼
        </span>
        <svg viewBox="-150 -150 300 300" className="size-[min(62vh,340px)]" style={{ transform: `rotate(${angle}deg)`, transition: angle ? "transform 4.2s cubic-bezier(.12,.75,.12,1)" : "none" }}>
          <circle r="148" fill="#111214" />
          {slices.map((s, i) => (
            <g key={i}>
              <path d={s.path} fill={s.fill} stroke="#111214" strokeWidth="1.5" />
              <text
                x={s.tx}
                y={s.ty}
                transform={`rotate(${s.rot} ${s.tx} ${s.ty})`}
                textAnchor="middle"
                dominantBaseline="middle"
                fontSize={options.length > 10 ? 9 : 12}
                fontWeight={700}
                fill={["#5865f2", "#f0b232", "#23a55a", "#eb459e"].includes(s.fill) ? "#111214" : "#f2f3f5"}
              >
                {s.label.length > 14 ? `${s.label.slice(0, 13)}…` : s.label}
              </text>
            </g>
          ))}
          <circle r="16" fill="#f2f3f5" />
        </svg>
        {spin && done && (
          <p className="pop-in absolute inset-x-0 -bottom-12 text-center font-display-wonk text-[26px]">
            🎉 <span className="text-ember-2">{spin.options[spin.winner]}</span>
          </p>
        )}
      </div>
      <div className="w-full max-w-[260px]">
        <p className="label mb-2 text-oat/45">Opções (uma por linha)</p>
        <textarea
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            try {
              localStorage.setItem("cdg:roleta", e.target.value);
            } catch {
              /* sem armazenamento */
            }
          }}
          className="field h-40 resize-none text-[14px]"
        />
        <button
          type="button"
          onClick={() => {
            const opts = text.split("\n").map((s) => s.trim()).filter(Boolean).slice(0, 16);
            if (opts.length >= 2) v.startSpin(opts);
          }}
          className="btn-ember mt-3 h-11 w-full text-[15px]"
        >
          Girar para todo mundo
        </button>
        {spin && <p className="mt-2 text-center text-[12px] text-oat/45">Última girada por {spin.by}</p>}
        <button type="button" onClick={onClose} className="link-u mx-auto mt-3 block text-[13px] text-oat/50 hover:text-oat">
          Fechar roleta
        </button>
      </div>
      </div>
    </div>
  );
}
