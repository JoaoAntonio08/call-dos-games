"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { create } from "zustand";
import { AtSign, Bell, MessageCircle, Play, X } from "lucide-react";
import { markRead, nameInChannel, useStore } from "@/lib/store";
import { toast, useRoute } from "@/lib/ui";
import type { Media, Message } from "@/lib/types";
import { Avatar, Toggle } from "./bits";

/* ------------------------------------------------------------------ */
/* Avisos de mensagem: som e pop-up por tipo, silenciar, marcar lida    */
/* ------------------------------------------------------------------ */

/** O que fazer quando chega uma mensagem de um tipo. */
export type AlertMode = "ambos" | "som" | "popup" | "nada";
export type SoundId = "gota" | "cristal" | "bolha" | "arcade" | "sininho" | "classico";
type Kind = "dm" | "mention" | "server";

interface Silence {
  /** legado: as versões antigas tinham só liga/desliga */
  enabled: boolean;
  servers: string[];
  channels: string[];
  dm: AlertMode;
  mention: AlertMode;
  server: AlertMode;
  dmSound: SoundId;
  serverSound: SoundId;
  /** 0 a 1 */
  volume: number;
  /** com o app minimizado ou em outra janela, usa o aviso do Windows */
  osPopup: boolean;
}

const DEFAULTS: Silence = {
  enabled: true,
  servers: [],
  channels: [],
  dm: "ambos",
  mention: "ambos",
  server: "ambos",
  dmSound: "cristal",
  serverSound: "gota",
  volume: 0.6,
  osPopup: true,
};
const KEY = "cdg:avisos";
const MODES: AlertMode[] = ["ambos", "som", "popup", "nada"];
function load(): Silence {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || "{}") as Partial<Silence>;
    const s = { ...DEFAULTS, ...saved };
    // quem tinha desligado os avisos na versão antiga continua sem aviso
    if (saved.enabled === false && !saved.dm) s.dm = s.mention = s.server = "nada";
    for (const k of ["dm", "mention", "server"] as const) if (!MODES.includes(s[k])) s[k] = DEFAULTS[k];
    if (!(s.dmSound in SOUNDS)) s.dmSound = DEFAULTS.dmSound;
    if (!(s.serverSound in SOUNDS)) s.serverSound = DEFAULTS.serverSound;
    s.volume = Math.max(0, Math.min(1, Number(s.volume) || 0));
    return s;
  } catch {
    return DEFAULTS;
  }
}
export const useSilence = create<Silence>(() => (typeof window === "undefined" ? DEFAULTS : load()));
function save(next: Partial<Silence>) {
  useSilence.setState(next);
  try {
    localStorage.setItem(KEY, JSON.stringify(useSilence.getState()));
  } catch {
    /* sem armazenamento: vale só nesta aba */
  }
}

export const isMuted = (s: Pick<Silence, "servers" | "channels">, serverId: string | null | undefined, channelId: string) =>
  s.channels.includes(channelId) || (!!serverId && s.servers.includes(serverId));

export function toggleServerMute(serverId: string) {
  const s = useSilence.getState();
  const on = !s.servers.includes(serverId);
  save({ servers: on ? [...s.servers, serverId] : s.servers.filter((x) => x !== serverId) });
  toast(on ? "Servidor silenciado: sem aviso e sem bolinha de não lida." : "Servidor sem silêncio de novo.");
}
export function toggleChannelMute(channelId: string) {
  const s = useSilence.getState();
  const on = !s.channels.includes(channelId);
  save({ channels: on ? [...s.channels, channelId] : s.channels.filter((x) => x !== channelId) });
  toast(on ? "Canal silenciado." : "Canal sem silêncio de novo.");
}

/** Marca como lido tudo de um servidor (ou um canal). */
export function markServerRead(serverId: string) {
  const sv = useStore.getState().servers[serverId];
  if (!sv) return;
  for (const c of sv.channels) if (c.type === "text") markRead(c.id, c.last_message_id);
}

/* ------------------------------------------------------------------ sons (sintetizados, sem arquivo) */

type Note = { f: number; to?: number; at: number; dur: number; type?: OscillatorType; gain?: number };
export const SOUNDS: Record<SoundId, { label: string; notes: Note[] }> = {
  gota: { label: "Gota", notes: [{ f: 1480, to: 740, at: 0, dur: 0.22 }, { f: 1760, to: 1100, at: 0.07, dur: 0.18, gain: 0.45 }] },
  cristal: {
    label: "Cristal",
    notes: [
      { f: 1568, at: 0, dur: 0.9, type: "triangle" },
      { f: 2093, at: 0.08, dur: 1, type: "triangle", gain: 0.8 },
      { f: 3136, at: 0.08, dur: 0.6, gain: 0.25 },
    ],
  },
  bolha: { label: "Bolha", notes: [{ f: 380, to: 920, at: 0, dur: 0.13 }, { f: 520, to: 1250, at: 0.11, dur: 0.14, gain: 0.8 }] },
  arcade: {
    label: "Arcade",
    notes: [
      { f: 988, at: 0, dur: 0.08, type: "square", gain: 0.35 },
      { f: 1319, at: 0.08, dur: 0.3, type: "square", gain: 0.35 },
    ],
  },
  sininho: {
    label: "Sininho",
    notes: [
      { f: 1046.5, at: 0, dur: 1.3 },
      { f: 2637, at: 0, dur: 0.5, gain: 0.3 },
      { f: 1318.5, at: 0.12, dur: 1.2, gain: 0.8 },
    ],
  },
  classico: { label: "Clássico", notes: [{ f: 880, at: 0, dur: 0.45 }] },
};

let ctx: AudioContext | null = null;
export function playAlert(id: SoundId, volume: number) {
  if (volume <= 0) return;
  try {
    ctx ??= new AudioContext();
    const c = ctx;
    if (c.state === "suspended") void c.resume();
    const out = c.createGain();
    out.gain.value = Math.min(1, volume);
    out.connect(c.destination);
    for (const n of (SOUNDS[id] ?? SOUNDS.classico).notes) {
      const o = c.createOscillator();
      const g = c.createGain();
      o.type = n.type ?? "sine";
      const t = c.currentTime + 0.01 + n.at;
      o.frequency.setValueAtTime(n.f, t);
      if (n.to) o.frequency.exponentialRampToValueAtTime(n.to, t + n.dur * 0.8);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.2 * (n.gain ?? 1), t + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t + n.dur);
      o.connect(g).connect(out);
      o.start(t);
      o.stop(t + n.dur + 0.05);
    }
  } catch {
    /* sem áudio */
  }
}

/* ------------------------------------------------------------------ pop-ups */

interface Popup {
  id: number;
  kind: Kind;
  channelId: string;
  title: string;
  where: string;
  body: string;
  path: string;
  avatar: Media | null;
  accent: string;
  /** quantas mensagens juntou (mesmo canal em seguida) */
  count: number;
}
const usePopups = create<{ list: Popup[] }>(() => ({ list: [] }));
let popupSeq = 0;
function pushPopup(p: Omit<Popup, "id" | "count">) {
  usePopups.setState((s) => {
    const same = s.list.find((x) => x.channelId === p.channelId && x.kind === p.kind);
    // mesma conversa: atualiza o cartão que já está na tela em vez de empilhar
    const rest = s.list.filter((x) => x !== same);
    return { list: [...rest, { ...p, id: ++popupSeq, count: (same?.count ?? 0) + 1 }].slice(-3) };
  });
}
const closePopup = (id: number) => usePopups.setState((s) => ({ list: s.list.filter((x) => x.id !== id) }));

const KIND_LABEL: Record<Kind, string> = { dm: "Mensagem direta", mention: "Te mencionou", server: "Servidor" };
const KIND_ICON = { dm: MessageCircle, mention: AtSign, server: Bell };
const LIFE = 6500;

function PopupCard({ p, onOpen }: { p: Popup; onOpen: (p: Popup) => void }) {
  const [hover, setHover] = useState(false);
  const Icon = KIND_ICON[p.kind];
  useEffect(() => {
    if (hover) return;
    const t = window.setTimeout(() => closePopup(p.id), LIFE);
    return () => window.clearTimeout(t);
  }, [hover, p.id]);
  return (
    <div
      role="alert"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      className="notif-in group pointer-events-auto relative w-[340px] max-w-[calc(100vw-32px)] overflow-hidden rounded-[16px] p-px shadow-[0_18px_50px_-12px_rgba(0,0,0,.7)]"
      style={{ background: `linear-gradient(135deg, ${p.accent}, color-mix(in srgb, ${p.accent} 25%, transparent) 55%, rgba(255,255,255,.08))` }}
    >
      <div className="relative overflow-hidden rounded-[15px] bg-cocoa-1/95 backdrop-blur-xl">
        <span aria-hidden className="notif-shine pointer-events-none absolute inset-0" />
        <span
          aria-hidden
          className="pointer-events-none absolute -left-10 -top-12 size-36 rounded-full opacity-30 blur-2xl"
          style={{ background: p.accent }}
        />
        <button type="button" onClick={() => onOpen(p)} className="relative flex w-full gap-3 p-3.5 pr-9 text-left">
          <span className="relative">
            <Avatar name={p.title} avatar={p.avatar} accent={p.accent} size={42} />
            <span className="absolute -bottom-1 -right-1 grid size-5 place-items-center rounded-full bg-ember text-white ring-2 ring-cocoa-1">
              <Icon className="size-3" />
            </span>
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex items-baseline gap-2">
              <span className="truncate text-[14.5px] font-bold text-oat">{p.title}</span>
              {p.count > 1 && <span className="shrink-0 rounded-full bg-ember px-1.5 text-[10.5px] font-bold text-white">{p.count}</span>}
            </span>
            <span className="block truncate text-[11.5px] font-semibold uppercase tracking-wide text-ember-2">{p.where}</span>
            <span className="mt-1 line-clamp-2 block text-[13.5px] leading-snug text-oat/80">{p.body}</span>
          </span>
        </button>
        <button
          type="button"
          onClick={() => closePopup(p.id)}
          aria-label="Fechar aviso"
          className="absolute right-2 top-2 grid size-6 place-items-center rounded-full text-oat/40 hover:bg-cocoa-4 hover:text-oat"
        >
          <X className="size-3.5" />
        </button>
        <span
          key={`${p.id}-${hover}`}
          aria-hidden
          className="notif-life absolute bottom-0 left-0 h-[3px] w-full origin-left"
          style={{ background: p.accent, animationDuration: `${LIFE}ms`, animationPlayState: hover ? "paused" : "running" }}
        />
      </div>
    </div>
  );
}

function PopupStack({ onOpen }: { onOpen: (p: Popup) => void }) {
  const list = usePopups((s) => s.list);
  if (!list.length) return null;
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[90] flex flex-col items-end gap-2.5" aria-live="polite">
      {list.map((p) => (
        <PopupCard key={p.id} p={p} onOpen={onOpen} />
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ quem escuta as mensagens */

const mentionRe = (username: string) => new RegExp(`(^|[^\\w@])@(${username.replace(/\./g, "\\.")}|todos|everyone)(?![\\w.])`, "i");
const soundOk = (m: AlertMode) => m === "ambos" || m === "som";
const popupOk = (m: AlertMode) => m === "ambos" || m === "popup";

/** Fica ouvindo as mensagens novas e avisa (som e/ou pop-up) do jeito que a pessoa escolheu. */
export function MessageAlerts() {
  const router = useRouter();
  const route = useRoute();
  const routeRef = useRef(route);
  const lastSound = useRef<Record<string, number>>({});
  useEffect(() => {
    routeRef.current = route;
  });

  useEffect(() => {
    const on = (e: Event) => {
      const m = (e as CustomEvent<Message>).detail;
      const st = useStore.getState();
      const me = st.me;
      const sil = useSilence.getState();
      if (!me || !m.author || m.author.id === me.id || m.ephemeral) return;
      const dm = st.dms.find((d) => d.id === m.channel_id);
      const server = dm ? undefined : Object.values(st.servers).find((s) => s.channels.some((c) => c.id === m.channel_id));
      if (!dm && !server) return;
      if (isMuted(sil, server?.id, m.channel_id)) return;
      const kind: Kind = dm ? "dm" : mentionRe(me.username).test(m.content) ? "mention" : "server";
      const mode = sil[kind];
      if (mode === "nada") return;
      const r = routeRef.current;
      const visible = document.hasFocus() && !document.hidden;
      const looking = visible && ((r.kind === "dm" && r.id === m.channel_id) || (r.kind === "server" && r.channelId === m.channel_id));
      if (looking) return;

      // som: no máximo um a cada 1,5 s por conversa, para uma conversa animada não virar sirene
      if (soundOk(mode)) {
        const now = Date.now();
        if (now - (lastSound.current[m.channel_id] ?? 0) > 1500) {
          lastSound.current[m.channel_id] = now;
          playAlert(kind === "server" ? sil.serverSound : sil.dmSound, sil.volume);
        }
      }
      if (!popupOk(mode)) return;

      const title = dm ? m.author.display_name : nameInChannel(m.channel_id, m.author.id, m.author.display_name);
      const chName = server?.channels.find((c) => c.id === m.channel_id)?.name ?? "canal";
      const where = dm ? KIND_LABEL.dm : `${kind === "mention" ? "Te mencionou · " : ""}#${chName} · ${server?.name ?? ""}`;
      const path = dm ? `/app/dm/${m.channel_id}` : `/app/s/${server?.id}/${m.channel_id}`;
      const body = (m.content || (m.attachments?.length ? "📎 Anexo" : "Mensagem nova")).slice(0, 180);
      try {
        if (!visible && sil.osPopup && "Notification" in window && Notification.permission === "granted") {
          // app minimizado ou em outra janela: aviso do Windows (o som já tocou aqui, ele vem sem som)
          const n = new Notification(`${title} (${where})`, { body, tag: `msg-${m.channel_id}`, silent: true });
          n.onclick = () => {
            window.focus();
            router.push(path);
            n.close();
          };
          return;
        }
      } catch {
        /* sem notificações do sistema: cai no pop-up do app */
      }
      pushPopup({ kind, channelId: m.channel_id, title, where, body, path, avatar: m.author.avatar ?? null, accent: m.author.accent || "#5865f2" });
    };
    window.addEventListener("cdg:message", on);
    return () => window.removeEventListener("cdg:message", on);
  }, [router]);

  // abriu a conversa: o aviso dela some
  useEffect(() => {
    const id = route.kind === "dm" ? route.id : route.kind === "server" ? route.channelId : null;
    if (id) usePopups.setState((s) => ({ list: s.list.filter((x) => x.channelId !== id) }));
  }, [route]);

  return (
    <PopupStack
      onOpen={(p) => {
        closePopup(p.id);
        router.push(p.path);
      }}
    />
  );
}

/* ------------------------------------------------------------------ aba "Notificações" */

const MODE_LABEL: Record<AlertMode, string> = { ambos: "Som e pop-up", som: "Só som", popup: "Só pop-up", nada: "Nada" };

function ModePicker({ value, onChange, label }: { value: AlertMode; onChange: (m: AlertMode) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="grid grid-cols-4 gap-1 rounded-[11px] bg-cocoa-3 p-1">
      {MODES.map((m) => (
        <button
          key={m}
          type="button"
          role="radio"
          aria-checked={value === m}
          onClick={() => onChange(m)}
          className={`rounded-[8px] px-2 py-1.5 text-[12.5px] font-semibold transition-colors ${value === m ? "bg-ember text-white shadow" : "text-oat/60 hover:bg-cocoa-4 hover:text-oat"}`}
        >
          {MODE_LABEL[m]}
        </button>
      ))}
    </div>
  );
}

function SoundPicker({ value, onChange, label, volume }: { value: SoundId; onChange: (s: SoundId) => void; label: string; volume: number }) {
  return (
    <div>
      <p className="mb-1.5 text-[13px] font-medium text-oat/80">{label}</p>
      <div className="flex flex-wrap gap-1.5">
        {(Object.keys(SOUNDS) as SoundId[]).map((id) => (
          <button
            key={id}
            type="button"
            aria-pressed={value === id}
            onClick={() => {
              onChange(id);
              playAlert(id, Math.max(volume, 0.25));
            }}
            className={`press flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12.5px] font-semibold transition-colors ${value === id ? "bg-ember text-white" : "bg-cocoa-3 text-oat/70 hover:bg-cocoa-4 hover:text-oat"}`}
          >
            <Play className="size-3" /> {SOUNDS[id].label}
          </button>
        ))}
      </div>
    </div>
  );
}

const ROWS: { kind: Kind; title: string; hint: string }[] = [
  { kind: "dm", title: "Mensagens diretas", hint: "Quando alguém te chama no privado." },
  { kind: "mention", title: "Menções", hint: "Quando alguém escreve @seunome ou @todos num servidor." },
  { kind: "server", title: "Mensagens dos servidores", hint: "Qualquer mensagem nova nos canais que não estão silenciados." },
];

export function NotificationsTab() {
  const sil = useSilence();
  const servers = useStore((s) => s.servers);
  const me = useStore((s) => s.me);
  const [perm, setPerm] = useState(() => (typeof window !== "undefined" && "Notification" in window ? Notification.permission : "denied"));
  const mutedServers = sil.servers.filter((id) => servers[id]);
  const mutedChannels = sil.channels
    .map((id) => {
      const sv = Object.values(servers).find((s) => s.channels.some((c) => c.id === id));
      const ch = sv?.channels.find((c) => c.id === id);
      return sv && ch ? { id, label: `#${ch.name} · ${sv.name}` } : null;
    })
    .filter((x): x is { id: string; label: string } => !!x);

  async function askPermission() {
    if ("Notification" in window && Notification.permission === "default") {
      try {
        setPerm(await Notification.requestPermission());
      } catch {
        /* navegador sem suporte */
      }
    }
  }

  return (
    <div className="max-w-xl">
      <h2 className="mb-6 pr-10 font-display text-[30px] leading-tight">Notificações</h2>

      <section className="mb-8 space-y-5">
        <p className="label text-oat/55">Quando avisar</p>
        {ROWS.map((r) => (
          <div key={r.kind}>
            <p className="text-[14.5px] font-medium">{r.title}</p>
            <p className="mb-2 text-[12.5px] text-oat/45">{r.hint}</p>
            <ModePicker value={sil[r.kind]} onChange={(m) => save({ [r.kind]: m })} label={r.title} />
          </div>
        ))}
      </section>

      <section className="mb-8 space-y-4">
        <p className="label text-oat/55">Som</p>
        <SoundPicker label="Mensagens diretas e menções" value={sil.dmSound} onChange={(s) => save({ dmSound: s })} volume={sil.volume} />
        <SoundPicker label="Mensagens dos servidores" value={sil.serverSound} onChange={(s) => save({ serverSound: s })} volume={sil.volume} />
        <label className="block">
          <span className="mb-1.5 flex justify-between text-[13px] font-medium text-oat/80">
            Volume <span className="text-oat/45">{Math.round(sil.volume * 100)}%</span>
          </span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={sil.volume}
            onChange={(e) => save({ volume: Number(e.target.value) })}
            onPointerUp={() => playAlert(sil.dmSound, sil.volume)}
            className="w-full accent-[var(--color-ember)]"
            aria-label="Volume dos avisos"
          />
        </label>
      </section>

      <section className="mb-8">
        <p className="label mb-3 text-oat/55">Pop-up</p>
        <label className="flex items-center justify-between gap-4 py-1">
          <span>
            <span className="block text-[14.5px] font-medium">Aviso do Windows com o app minimizado</span>
            <span className="block text-[12.5px] text-oat/45">Com o app aberto na frente, o aviso aparece no canto da tela do próprio app.</span>
          </span>
          <Toggle
            checked={sil.osPopup}
            onChange={(v) => {
              save({ osPopup: v });
              if (v) void askPermission();
            }}
            label="Aviso do Windows com o app minimizado"
          />
        </label>
        {sil.osPopup && perm === "denied" && (
          <p className="mt-2 rounded-[10px] bg-honey/15 px-3 py-2 text-[12.5px] text-honey">
            O navegador bloqueou as notificações deste site. Com a aba em segundo plano o aviso aparece quando você voltar; para ver fora da aba, libere as
            notificações no cadeado da barra de endereço.
          </p>
        )}
        <button
          type="button"
          onClick={() => {
            playAlert(sil.dmSound, sil.volume);
            pushPopup({
              kind: "dm",
              channelId: "teste",
              title: me?.display_name ?? "Você",
              where: "Teste de aviso",
              body: "É assim que as mensagens novas vão aparecer. Passe o mouse para o aviso ficar parado.",
              path: "/app",
              avatar: me?.avatar ?? null,
              accent: me?.accent || "#5865f2",
            });
          }}
          className="btn-ember mt-4 px-4 py-2 text-[14px]"
        >
          Testar aviso
        </button>
      </section>

      <section>
        <p className="label mb-2 text-oat/55">Silenciados</p>
        <p className="mb-3 text-[12.5px] text-oat/45">Clique com o botão direito num servidor ou canal para silenciar: sem aviso e sem bolinha de não lida.</p>
        {mutedServers.length + mutedChannels.length === 0 ? (
          <p className="text-[13.5px] text-oat/40">Nada silenciado.</p>
        ) : (
          <ul className="space-y-1.5">
            {mutedServers.map((id) => (
              <li key={id} className="flex items-center justify-between rounded-[10px] bg-cocoa-3 px-3 py-2 text-[14px]">
                {servers[id].name}
                <button type="button" onClick={() => toggleServerMute(id)} className="text-[12.5px] font-semibold text-ember-2 hover:underline">
                  Tirar o silêncio
                </button>
              </li>
            ))}
            {mutedChannels.map((c) => (
              <li key={c.id} className="flex items-center justify-between rounded-[10px] bg-cocoa-3 px-3 py-2 text-[14px]">
                {c.label}
                <button type="button" onClick={() => toggleChannelMute(c.id)} className="text-[12.5px] font-semibold text-ember-2 hover:underline">
                  Tirar o silêncio
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
