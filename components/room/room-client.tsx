"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  Headphones,
  HeadphoneOff,
  Mic,
  MicOff,
  MonitorOff,
  MonitorUp,
  Settings2,
  TvMinimalPlay,
  Video,
  VideoOff,
} from "lucide-react";
import { DEFAULT_SHARE, RESOLUTIONS, keyTokenFetcher, useCall, type ShareSettings } from "@/lib/use-call";
import { useYouTubeSync } from "@/lib/use-youtube-sync";
import { loadJSON, loadName, saveJSON, saveName, takeAutoJoin } from "@/lib/prefs";
import { TrackAudio } from "./media";
import { PeerTile } from "./peer-tile";
import { ScreenStage } from "./screen-stage";
import { YouTubeStage } from "./youtube-stage";
import { DevicesPanel, SharePanel, YouTubePanel } from "./panels";

type PanelId = "share" | "yt" | "devices" | null;

/** Botão do dock: ícone em cima, rótulo mono embaixo. Desligado = risco vermelho. */
function DockButton({
  label,
  short,
  onClick,
  off,
  active,
  expanded,
  children,
}: {
  label: string;
  short: string;
  onClick: () => void;
  off?: boolean;
  active?: boolean;
  expanded?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      aria-pressed={off === undefined ? undefined : !off}
      aria-expanded={expanded}
      className={`press relative flex h-full w-14 shrink-0 flex-col items-center justify-center gap-1.5 sm:w-[76px] [&_svg]:size-[19px] ${
        active ? "bg-paper text-ink" : off ? "text-signal hover:bg-signal/10" : "text-paper hover:bg-paper/[0.07]"
      } ${expanded ? "bg-paper/[0.07]" : ""}`}
    >
      {children}
      <span className="label hidden text-[10px] sm:block">{short}</span>
      {expanded && <span aria-hidden className="absolute inset-x-0 top-0 h-[2px] bg-signal" />}
    </button>
  );
}

export function RoomClient({ roomKey }: { roomKey: string }) {
  const call = useCall();
  const yt = useYouTubeSync(call.room, call.flash);

  const [name, setName] = useState("");
  const [wantMic, setWantMic] = useState(true);
  const [wantCam, setWantCam] = useState(false);
  const [panel, setPanel] = useState<PanelId>(null);
  const [share, setShare] = useState<ShareSettings>(DEFAULT_SHARE);
  const [pinned, setPinned] = useState<string | null>(null);
  const [voiceVol, setVoiceVol] = useState<Record<string, number>>({});
  const [screenVol, setScreenVol] = useState<Record<string, number>>({});
  const [deaf, setDeaf] = useState(false);
  const [copied, setCopied] = useState(false);

  // preferências salvas e entrada direta vinda do lobby
  useEffect(() => {
    const n = loadName();
    setName(n);
    setShare(loadJSON("share", DEFAULT_SHARE));
    if (n && takeAutoJoin(roomKey)) void call.join(keyTokenFetcher(roomKey, n), { mic: true, camera: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomKey]);

  useEffect(() => {
    document.title = `${roomKey} · Call dos Games`;
  }, [roomKey]);

  useEffect(() => {
    if (!copied) return;
    const t = window.setTimeout(() => setCopied(false), 1800);
    return () => window.clearTimeout(t);
  }, [copied]);

  const inCall = call.status === "connected" || call.status === "reconnecting";
  const me = call.peers.find((p) => p.isLocal);

  /* ---------------- palco ---------------- */
  const screens = call.peers.filter((p) => p.screen);
  const options = [
    ...(yt.state ? [{ id: "yt", label: "YouTube" }] : []),
    ...screens.map((p) => ({ id: `s:${p.identity}`, label: p.isLocal ? "Sua tela" : `Tela de ${p.name}` })),
  ];
  const autoStage = yt.state ? "yt" : screens.length ? `s:${(screens.find((p) => !p.isLocal) ?? screens[0]).identity}` : null;
  const stage = pinned && options.some((o) => o.id === pinned) ? pinned : autoStage;
  const stagePeer = stage?.startsWith("s:") ? screens.find((p) => `s:${p.identity}` === stage) : undefined;

  if (!inCall) {
    return (
      <PreJoin
        roomKey={roomKey}
        name={name}
        setName={setName}
        mic={wantMic}
        setMic={setWantMic}
        cam={wantCam}
        setCam={setWantCam}
        status={call.status}
        error={call.error}
        onJoin={() => {
          saveName(name.trim());
          void call.join(keyTokenFetcher(roomKey, name.trim()), { mic: wantMic, camera: wantCam });
        }}
      />
    );
  }

  const n = call.peers.length;
  const cols = n <= 1 ? 1 : n <= 4 ? 2 : n <= 9 ? 3 : 4;
  const rows = Math.ceil(n / cols);

  const tiles = (compact: boolean) =>
    call.peers.map((p) => (
      <PeerTile
        key={p.identity}
        peer={p}
        compact={compact}
        volume={voiceVol[p.identity] ?? 1}
        onVolume={(v) => setVoiceVol((m) => ({ ...m, [p.identity]: v }))}
      />
    ));

  async function invite() {
    try {
      await navigator.clipboard.writeText(`${location.origin}/sala/${roomKey}`);
      setCopied(true);
    } catch {
      call.flash(`Chave da sala: ${roomKey}`);
    }
  }

  return (
    <div className="relative flex h-svh flex-col overflow-hidden bg-ink text-paper">
      {/* faixa superior */}
      <header className="grid h-12 shrink-0 grid-cols-[auto_1fr_auto] items-center gap-4 border-b border-paper/15 px-4">
        <Link href="/" className="whitespace-nowrap font-display text-[24px] leading-none transition-colors hover:text-signal" aria-label="Início">
          Call dos Games
        </Link>
        <div className="flex min-w-0 items-center gap-3">
          <span className="live-dot shrink-0" aria-hidden />
          <span className="truncate text-[13px] font-medium">{roomKey}</span>
          <button type="button" onClick={invite} className="label link-u shrink-0 text-paper/60 hover:text-paper">
            {copied ? "Link copiado ✓" : "Copiar convite"}
          </button>
        </div>
        <div className="flex items-center gap-4">
          {call.status === "reconnecting" && <span className="label text-signal">Reconectando…</span>}
          <span className="label tabular-nums text-paper/60" title="Pessoas na sala" data-count={n}>
            {String(n).padStart(2, "0")} {n === 1 ? "pessoa" : "pessoas"}
          </span>
        </div>
      </header>

      {/* centro */}
      <main className="flex min-h-0 flex-1 flex-col gap-4 p-3 sm:p-4 lg:flex-row">
        {stage ? (
          <>
            <section className="flex min-h-0 min-w-0 flex-1 flex-col">
              {options.length > 1 && (
                <div className="mb-3 flex shrink-0 gap-5 overflow-x-auto" role="tablist" aria-label="O que mostrar no palco">
                  {options.map((o) => (
                    <button
                      key={o.id}
                      type="button"
                      role="tab"
                      aria-selected={o.id === stage}
                      onClick={() => setPinned(o.id)}
                      className={`label shrink-0 border-b-2 pb-1.5 transition-colors ${
                        o.id === stage ? "border-signal text-paper" : "border-transparent text-paper/45 hover:text-paper"
                      }`}
                    >
                      {o.label}
                    </button>
                  ))}
                </div>
              )}
              <div className="relative min-h-0 flex-1">
                {/* o player do YouTube fica montado para não perder a sincronia ao trocar de palco */}
                {yt.state && (
                  <div className={stage === "yt" ? "absolute inset-0" : "hidden"}>
                    <YouTubeStage yt={yt} />
                  </div>
                )}
                {stagePeer && (
                  <div className="absolute inset-0">
                    <ScreenStage
                      peer={stagePeer}
                      volume={screenVol[stagePeer.identity] ?? 1}
                      onVolume={(v) => setScreenVol((m) => ({ ...m, [stagePeer.identity]: v }))}
                    />
                  </div>
                )}
              </div>
            </section>
            <aside
              aria-label="Pessoas na sala"
              className="flex h-24 shrink-0 gap-2 overflow-x-auto sm:h-28 lg:h-auto lg:w-56 lg:flex-col lg:overflow-y-auto lg:overflow-x-hidden lg:border-l lg:border-paper/15 lg:pl-4 xl:w-64 [&>*]:w-44 [&>*]:shrink-0 sm:[&>*]:w-48 lg:[&>*]:w-full"
            >
              {tiles(true)}
            </aside>
          </>
        ) : (
          <div className="grid min-h-0 flex-1 place-items-center">
            <div
              className="grid w-full gap-2"
              style={{
                gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
                maxWidth: `min(100%, calc((100svh - 190px) / ${rows} * 16 / 9 * ${cols}))`,
              }}
            >
              {tiles(false)}
            </div>
            {n === 1 && (
              <p className="mt-6 max-w-sm text-center text-[13px] text-paper/50">
                Só você por aqui. <button type="button" onClick={invite} className="link-u text-paper">Copie o convite</button> e
                mande para a turma.
              </p>
            )}
          </div>
        )}
      </main>

      {/* dock */}
      <footer className="relative grid h-[68px] shrink-0 grid-cols-[1fr_auto_1fr] items-stretch border-t border-paper/15 sm:h-[72px]">
        {panel && (
          <div className="absolute bottom-full left-1/2 z-30 -translate-x-1/2">
            {panel === "share" && (
              <SharePanel
                initial={share}
                viewers={n - 1}
                onClose={() => setPanel(null)}
                onStart={(s) => {
                  setShare(s);
                  saveJSON("share", { ...loadJSON("share", {}), ...s });
                  setPanel(null);
                  void call.startShare(s);
                }}
              />
            )}
            {panel === "yt" && (
              <YouTubePanel
                onClose={() => setPanel(null)}
                onLoad={(url) => {
                  const ok = yt.load(url);
                  if (ok) setPinned("yt");
                  return ok;
                }}
              />
            )}
            {panel === "devices" && call.room && <DevicesPanel room={call.room} onClose={() => setPanel(null)} />}
          </div>
        )}

        <div className="hidden items-center px-4 md:flex">
          {call.sharing ? (
            <span className="label text-signal">
              Transmitindo {RESOLUTIONS[call.sharing.resolution].label} · {call.sharing.fps} fps
            </span>
          ) : deaf ? (
            <span className="label text-signal">Todo mundo silenciado</span>
          ) : null}
        </div>

        <nav aria-label="Controles da call" className="col-start-2 flex items-stretch">
          <DockButton label={me?.micOn ? "Desligar microfone" : "Ligar microfone"} short="Mic" off={!me?.micOn} onClick={call.toggleMic}>
            {me?.micOn ? <Mic /> : <MicOff />}
          </DockButton>
          <DockButton label={me?.camera ? "Desligar câmera" : "Ligar câmera"} short="Câmera" off={!me?.camera} onClick={call.toggleCamera}>
            {me?.camera ? <Video /> : <VideoOff />}
          </DockButton>
          <DockButton label={deaf ? "Voltar a ouvir" : "Silenciar todo mundo"} short="Ouvir" off={deaf} onClick={() => setDeaf(!deaf)}>
            {deaf ? <HeadphoneOff /> : <Headphones />}
          </DockButton>
          <span className="mx-1 w-px self-center bg-paper/15 sm:mx-2" style={{ height: 28 }} />
          {call.sharing ? (
            <DockButton label="Parar de compartilhar" short="Parar" active onClick={() => void call.stopShare()}>
              <MonitorOff />
            </DockButton>
          ) : (
            <DockButton label="Compartilhar tela" short="Tela" expanded={panel === "share"} onClick={() => setPanel(panel === "share" ? null : "share")}>
              <MonitorUp />
            </DockButton>
          )}
          <DockButton label="Assistir no YouTube" short="YouTube" expanded={panel === "yt"} onClick={() => setPanel(panel === "yt" ? null : "yt")}>
            <TvMinimalPlay />
          </DockButton>
          <DockButton label="Dispositivos" short="Ajustes" expanded={panel === "devices"} onClick={() => setPanel(panel === "devices" ? null : "devices")}>
            <Settings2 />
          </DockButton>
        </nav>

        <div className="flex items-center justify-end pr-3 sm:pr-4">
          <button
            type="button"
            onClick={() => void call.leave()}
            aria-label="Sair da sala"
            className="press label h-10 bg-signal px-4 text-ink hover:bg-paper sm:px-5"
          >
            Sair
          </button>
        </div>
      </footer>

      {/* áudio de todo mundo (fora do layout) */}
      <div hidden>
        {call.peers
          .filter((p) => !p.isLocal)
          .map((p) => (
            <span key={p.identity}>
              {p.mic && <TrackAudio track={p.mic} volume={deaf ? 0 : (voiceVol[p.identity] ?? 1)} />}
              {p.screenAudio && <TrackAudio track={p.screenAudio} volume={deaf ? 0 : (screenVol[p.identity] ?? 1)} />}
            </span>
          ))}
      </div>

      {!call.canPlayAudio && (
        <button
          type="button"
          onClick={call.startAudio}
          className="press slide-in absolute left-4 top-16 z-40 border-l-4 border-signal bg-paper px-4 py-3 text-left text-[13px] font-medium text-ink"
        >
          O navegador bloqueou o som. Clique aqui para ouvir a sala.
        </button>
      )}

      {call.notice && (
        <div
          role="status"
          key={call.notice}
          className="slide-in pointer-events-none absolute bottom-[84px] left-3 z-40 max-w-[calc(100%-24px)] border-l-4 border-signal bg-paper px-4 py-2.5 text-[13px] text-ink sm:left-4 sm:max-w-md"
        >
          {call.notice}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Antes de entrar                                                     */
/* ------------------------------------------------------------------ */

function PreJoin({
  roomKey,
  name,
  setName,
  mic,
  setMic,
  cam,
  setCam,
  status,
  error,
  onJoin,
}: {
  roomKey: string;
  name: string;
  setName: (s: string) => void;
  mic: boolean;
  setMic: (b: boolean) => void;
  cam: boolean;
  setCam: (b: boolean) => void;
  status: string;
  error: string;
  onJoin: () => void;
}) {
  const busy = status === "connecting";
  return (
    <main className="flex min-h-svh flex-1 flex-col bg-paper text-ink">
      <header className="flex items-center justify-between border-b border-ink px-4 py-3 sm:px-6">
        <Link href="/" className="font-display text-[26px] leading-none transition-colors hover:text-signal">
          Call dos Games
        </Link>
        <Link href="/" className="label link-u">
          ← Outra sala
        </Link>
      </header>

      <div className="grid flex-1 grid-cols-12">
        <section className="col-span-12 flex flex-col justify-end border-b border-ink px-4 py-10 sm:px-6 lg:col-span-7 lg:border-b-0 lg:border-r lg:py-14">
          <span className="label opacity-60">{status === "disconnected" ? "Você saiu da sala" : "Você vai entrar em"}</span>
          <h1 className="mt-4 break-all font-display text-[clamp(52px,9vw,140px)] leading-[0.88] tracking-[-0.02em]">
            {roomKey}
            <span className="text-signal">.</span>
          </h1>
        </section>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim() && !busy) onJoin();
          }}
          className="col-span-12 flex flex-col justify-end px-4 py-10 sm:px-6 lg:col-span-5 lg:py-14 lg:pl-10"
        >
          <label className="block">
            <span className="label opacity-60">01 — Seu nome</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={32}
              autoFocus={!name}
              placeholder="Como te chamam na call"
              className="mt-3 w-full border-0 border-b-2 border-ink bg-transparent pb-2 font-display text-[34px] leading-tight outline-none transition-colors placeholder:text-ink/25 focus:border-signal"
            />
          </label>

          <fieldset className="mt-9">
            <legend className="label opacity-60">02 — Entrar com</legend>
            <div className="mt-3 grid grid-cols-2 border border-ink">
              {[
                { on: mic, set: setMic, label: "Microfone", On: Mic, Off: MicOff },
                { on: cam, set: setCam, label: "Câmera", On: Video, Off: VideoOff },
              ].map(({ on, set, label, On, Off }, i) => (
                <button
                  key={label}
                  type="button"
                  aria-pressed={on}
                  onClick={() => set(!on)}
                  className={`press flex h-12 items-center justify-between px-3.5 text-[13px] font-medium ${i ? "border-l border-ink" : ""} ${
                    on ? "bg-ink text-paper" : "text-ink/55 hover:bg-ink/5"
                  }`}
                >
                  <span className={on ? "" : "line-through decoration-signal decoration-2"}>{label}</span>
                  {on ? <On className="size-4" /> : <Off className="size-4 text-signal" />}
                </button>
              ))}
            </div>
          </fieldset>

          {error && (
            <p role="alert" className="mt-5 border-l-4 border-signal pl-3 text-[13px] leading-relaxed">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={busy || !name.trim()}
            className="press group mt-8 flex h-16 w-full items-center justify-between bg-ink px-5 text-paper hover:bg-signal disabled:cursor-not-allowed disabled:bg-ink/40"
          >
            <span className="font-display text-[28px] leading-none">
              {busy ? "Conectando…" : status === "disconnected" ? "Entrar de novo" : "Entrar na sala"}
            </span>
            <span aria-hidden className="text-xl transition-transform duration-200 group-hover:translate-x-1.5">
              {busy ? "···" : "→"}
            </span>
          </button>
        </form>
      </div>
    </main>
  );
}
