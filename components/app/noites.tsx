"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarClock, Crown, Pencil, PartyPopper, Plus, Trash2, Volume2, X } from "lucide-react";
import { api, errorText } from "@/lib/api";
import { useStore } from "@/lib/store";
import { toast, useUI } from "@/lib/ui";
import { chime, useVoice } from "@/lib/voice";
import type { Server, User } from "@/lib/types";
import { Avatar, FormError } from "./bits";
import { askNotifications } from "./hype";

/* ------------------------------------------------------------------ */
/* Noite da turma: evento marcado, lembrete, call pronta e presença     */
/* ------------------------------------------------------------------ */

type Rsvp = "vou" | "talvez" | "nao";

interface Noite {
  id: string;
  server_id: string;
  title: string;
  description: string;
  starts_at: string;
  ends_at: string;
  duration_min: number;
  weekly: boolean;
  voice_channel_id: string | null;
  text_channel_id: string | null;
  activity: "" | "watch" | "dj" | "jogo" | "papo";
  media_url: string;
  remind_min: number;
  live: boolean;
  rsvps: { user_id: string; status: Rsvp }[];
  me: Rsvp | null;
}

interface Noites {
  events: Noite[];
  ranking: { user_id: string; nights: number; seconds: number }[];
  recent: { night: string; title: string; people: string[] }[];
}

/** Aviso que chega pelo gateway (lembrete ou começou). */
interface Chamado {
  id: string;
  server_id: string;
  server_name: string;
  title: string;
  starts_at: string;
  channel_id: string | null;
  channel_name: string;
  activity: Noite["activity"];
  media_url: string;
  going: number;
  in_call: number;
}

const ACTIVITY: Record<Noite["activity"], string> = {
  "": "Só a call",
  papo: "Papo e resenha",
  watch: "Sessão de vídeo (watch party)",
  dj: "Música com o DJ",
  jogo: "Jogatina",
};
const ACTIVITY_ICON: Record<Noite["activity"], string> = { "": "🔊", papo: "💬", watch: "🍿", dj: "🎧", jogo: "🎮" };

function whenOf(iso: string) {
  const d = new Date(iso);
  const day = d.toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "short" });
  return `${day[0].toUpperCase()}${day.slice(1)} · ${d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`;
}

function untilOf(iso: string, now: number) {
  const ms = new Date(iso).getTime() - now;
  if (ms <= 0) return "agora";
  const min = Math.round(ms / 60000);
  if (min < 60) return `em ${min} min`;
  const h = Math.round(min / 60);
  if (h < 36) return `em ${h} h`;
  return `em ${Math.round(h / 24)} dias`;
}

function hoursOf(seconds: number) {
  const m = Math.round(seconds / 60);
  return m >= 60 ? `${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}` : `${m} min`;
}

/** valor para o campo datetime-local, no horário de quem está mexendo */
function localInput(d: Date) {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** próxima sexta às 21h */
function nextFriday() {
  const d = new Date();
  d.setHours(21, 0, 0, 0);
  let add = (5 - d.getDay() + 7) % 7;
  if (add === 0 && d.getTime() < Date.now()) add = 7;
  d.setDate(d.getDate() + add);
  return d;
}

function useNow(every = 30_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), every);
    return () => window.clearInterval(t);
  }, [every]);
  return now;
}

export function NoitesView({ server }: { server: Server }) {
  const me = useStore((s) => s.me);
  const admin = server.members.find((m) => m.user.id === me?.id)?.role !== "member";
  const [data, setData] = useState<Noites | null>(null);
  const [editing, setEditing] = useState<Noite | "new" | null>(null);
  const now = useNow();

  const load = useCallback(() => {
    api<Noites>(`/servers/${server.id}/noites`)
      .then(setData)
      .catch((e) => toast(errorText(e)));
  }, [server.id]);

  useEffect(() => {
    load();
    const on = (e: Event) => {
      if ((e as CustomEvent<{ server_id: string }>).detail.server_id === server.id) load();
    };
    window.addEventListener("cdg:events-changed", on);
    return () => window.removeEventListener("cdg:events-changed", on);
  }, [server.id, load]);

  const users: Record<string, User> = Object.fromEntries(server.members.map((m) => [m.user.id, m.user]));
  const nameOf = (id: string) => server.members.find((m) => m.user.id === id)?.nickname || users[id]?.display_name || "Alguém que saiu";
  const events = data?.events ?? [];
  const [next, ...later] = events;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex h-12 shrink-0 items-center gap-2.5 border-b border-cocoa-0/50 px-3 sm:px-4">
        <button type="button" onClick={() => useUI.setState({ navOpen: true })} className="press -ml-1 rounded-md p-1.5 text-oat/60 md:hidden" aria-label="Abrir menu">
          <PartyPopper className="size-5" />
        </button>
        <PartyPopper className="hidden size-5 text-ember-2 md:block" />
        <h1 className="font-semibold">Noite da turma</h1>
        {admin && (
          <button type="button" onClick={() => setEditing("new")} className="btn-ember ml-auto inline-flex h-8 items-center gap-1.5 px-3 text-[13px]">
            <Plus className="size-4" /> Marcar noite
          </button>
        )}
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[1000px] px-4 pb-16 pt-8 sm:px-8">
          <div className="max-w-[560px]">
            <p className="label text-ember-2">{server.name}</p>
            <h2 className="mt-2 font-display text-[clamp(34px,5vw,52px)] leading-[0.95]">Bora marcar?</h2>
            <p className="mt-3 text-[15px] leading-relaxed text-oat/55">
              Uma noite fixa da turma, tipo toda sexta às 21h. Todo mundo recebe um lembrete antes, na hora a call já chama a galera com o vídeo ou a música pronta, e quem aparece entra no Hall da presença.
            </p>
          </div>

          {editing && <NoiteForm key={editing === "new" ? "new" : editing.id} server={server} noite={editing === "new" ? null : editing} onDone={() => setEditing(null)} />}

          {!data ? (
            <p className="mt-12 text-[14px] text-oat/40">Abrindo a agenda…</p>
          ) : !next ? (
            !editing && (
              <div className="mt-12 border-l-2 border-ember/50 pl-5">
                <p className="font-display text-[22px]">Nenhuma noite marcada.</p>
                <p className="mt-1 max-w-[440px] text-[14.5px] text-oat/50">
                  {admin ? "Use “Marcar noite” ali em cima para começar a tradição." : "Peça para um admin do servidor marcar a primeira."}
                </p>
              </div>
            )
          ) : (
            <>
              <NoiteHero noite={next} server={server} now={now} admin={admin} users={users} onEdit={() => setEditing(next)} />
              {later.length > 0 && (
                <div className="mt-6 space-y-2">
                  <p className="label text-oat/45">Depois</p>
                  {later.map((n) => (
                    <NoiteRow key={n.id} noite={n} now={now} admin={admin} onEdit={() => setEditing(n)} />
                  ))}
                </div>
              )}
            </>
          )}

          {data && (data.ranking.length > 0 || data.recent.length > 0) && (
            <div className="mt-12 grid gap-8 md:grid-cols-[1.1fr_1fr]">
              <section>
                <h3 className="font-display text-[24px]">Hall da presença</h3>
                <p className="mt-1 text-[13.5px] text-oat/50">Quem mais apareceu nas noites (conta quem ficou pelo menos 10 minutos na call).</p>
                <ol className="mt-4 space-y-1.5">
                  {data.ranking.map((r, i) => {
                    const u = users[r.user_id];
                    return (
                      <li key={r.user_id} className={`flex items-center gap-3 rounded-[12px] px-3 py-2 ${i === 0 ? "bg-ember/[0.09]" : "bg-cocoa-2"}`}>
                        <span className="grid w-5 place-items-center text-[13px] font-bold tabular-nums text-oat/45">{i === 0 ? <Crown className="size-4 text-honey" /> : i + 1}</span>
                        {u && <Avatar name={u.display_name} avatar={u.avatar} accent={u.accent} size={30} />}
                        <span className="min-w-0 flex-1 truncate font-medium">{nameOf(r.user_id)}</span>
                        <span className="text-[13px] tabular-nums text-oat/60">
                          {r.nights} {r.nights === 1 ? "noite" : "noites"} · {hoursOf(r.seconds)}
                        </span>
                      </li>
                    );
                  })}
                </ol>
              </section>
              <section>
                <h3 className="font-display text-[24px]">Últimas noites</h3>
                <ul className="mt-4 space-y-3">
                  {data.recent.map((r) => (
                    <li key={r.night} className="rounded-[12px] border border-oat/[0.06] bg-cocoa-2 p-3">
                      <p className="text-[14px] font-semibold">{r.title}</p>
                      <p className="text-[12px] text-oat/45">{whenOf(r.night)}</p>
                      <div className="mt-2 flex flex-wrap items-center -space-x-1.5">
                        {r.people.slice(0, 14).map((id) => {
                          const u = users[id];
                          return u ? (
                            <span key={id} className="rounded-full ring-2 ring-cocoa-2" title={nameOf(id)}>
                              <Avatar name={u.display_name} avatar={u.avatar} accent={u.accent} size={26} />
                            </span>
                          ) : null;
                        })}
                        <span className="pl-3 text-[12.5px] text-oat/55">{r.people.length} na call</span>
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function RsvpButtons({ noite }: { noite: Noite }) {
  const [busy, setBusy] = useState(false);
  async function answer(status: Rsvp) {
    setBusy(true);
    try {
      await api(`/noites/${noite.id}/rsvp`, { method: "PUT", json: { status: noite.me === status ? null : status } });
      // atualiza já (sem esperar o aviso do gateway, que pode estar reconectando)
      window.dispatchEvent(new CustomEvent("cdg:events-changed", { detail: { server_id: noite.server_id } }));
      askNotifications();
    } catch (e) {
      toast(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  const opts: [Rsvp, string][] = [
    ["vou", "Vou"],
    ["talvez", "Talvez"],
    ["nao", "Não vou"],
  ];
  return (
    <div className="flex gap-1.5" role="group" aria-label="Você vai?">
      {opts.map(([k, label]) => (
        <button
          key={k}
          type="button"
          disabled={busy}
          aria-pressed={noite.me === k}
          onClick={() => void answer(k)}
          className={`h-9 rounded-[10px] px-3.5 text-[13.5px] font-semibold transition-colors ${
            noite.me === k ? (k === "nao" ? "bg-rust/80 text-white" : "bg-ember text-white") : "bg-cocoa-0/50 text-oat/70 hover:bg-cocoa-0/80 hover:text-oat"
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function NoiteHero({ noite, server, now, admin, users, onEdit }: { noite: Noite; server: Server; now: number; admin: boolean; users: Record<string, User>; onEdit: () => void }) {
  const router = useRouter();
  const v = useVoice();
  const voice = server.channels.find((c) => c.id === noite.voice_channel_id);
  const going = noite.rsvps.filter((r) => r.status === "vou");
  const maybe = noite.rsvps.filter((r) => r.status === "talvez").length;
  const inCall = useStore((s) => (noite.voice_channel_id ? (s.voice[noite.voice_channel_id]?.length ?? 0) : 0));

  return (
    <article className={`relative mt-10 overflow-hidden rounded-[20px] border ${noite.live ? "border-ember/60" : "border-oat/[0.07]"} bg-cocoa-2`}>
      <div className="h-1.5 bg-gradient-to-r from-ember via-honey to-rust" />
      <div className="p-5 sm:p-7">
        <div className="flex flex-wrap items-start gap-3">
          <div className="min-w-0 flex-1">
            <p className={`label ${noite.live ? "text-ember-2" : "text-honey"}`}>
              {noite.live ? "● Rolando agora" : `${noite.weekly ? "Toda semana · " : ""}${untilOf(noite.starts_at, now)}`}
            </p>
            <h3 className="mt-1.5 font-display text-[clamp(26px,4vw,38px)] leading-[1.02]">{noite.title}</h3>
            <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[14px] text-oat/65">
              <span className="inline-flex items-center gap-1.5">
                <CalendarClock className="size-4" /> {whenOf(noite.starts_at)}
              </span>
              {voice && <span>🔊 {voice.name}</span>}
              <span>
                {ACTIVITY_ICON[noite.activity]} {ACTIVITY[noite.activity]}
              </span>
            </p>
            {noite.description && <p className="mt-3 max-w-[560px] whitespace-pre-wrap text-[14.5px] leading-relaxed text-oat/75">{noite.description}</p>}
          </div>
          {admin && (
            <div className="flex gap-1">
              <button type="button" onClick={onEdit} className="rounded-md p-2 text-oat/50 hover:bg-cocoa-3 hover:text-oat" aria-label="Editar noite">
                <Pencil className="size-4" />
              </button>
              <DeleteNoite noite={noite} />
            </div>
          )}
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-4">
          {noite.live && voice ? (
            <button
              type="button"
              className="btn-ember inline-flex h-10 items-center gap-2 px-5 text-[14.5px]"
              onClick={() => {
                router.push(`/app/s/${server.id}/${voice.id}`);
                startMedia(voice.id, noite.media_url, noite.activity);
                void v.join(voice.id);
              }}
            >
              <Volume2 className="size-4" /> Entrar na call {inCall > 0 && `(${inCall} lá)`}
            </button>
          ) : (
            <RsvpButtons noite={noite} />
          )}
          <div className="flex items-center gap-2">
            <div className="flex -space-x-1.5">
              {going.slice(0, 8).map((r) => {
                const u = users[r.user_id];
                return u ? (
                  <span key={r.user_id} className="rounded-full ring-2 ring-cocoa-2" title={u.display_name}>
                    <Avatar name={u.display_name} avatar={u.avatar} accent={u.accent} size={28} />
                  </span>
                ) : null;
              })}
            </div>
            <span className="text-[13px] text-oat/55">
              {going.length ? `${going.length} ${going.length === 1 ? "vai" : "vão"}` : "Ninguém confirmou ainda"}
              {maybe ? ` · ${maybe} talvez` : ""}
            </span>
          </div>
        </div>
        {noite.live && (
          <div className="mt-4">
            <RsvpButtons noite={noite} />
          </div>
        )}
      </div>
    </article>
  );
}

function NoiteRow({ noite, now, admin, onEdit }: { noite: Noite; now: number; admin: boolean; onEdit: () => void }) {
  const going = noite.rsvps.filter((r) => r.status === "vou").length;
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-[14px] bg-cocoa-2 px-4 py-3">
      <span className="text-[20px]" aria-hidden>
        {ACTIVITY_ICON[noite.activity]}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate font-semibold">{noite.title}</p>
        <p className="text-[12.5px] text-oat/50">
          {whenOf(noite.starts_at)} · {untilOf(noite.starts_at, now)}
          {noite.weekly ? " · toda semana" : ""} · {going} {going === 1 ? "vai" : "vão"}
        </p>
      </div>
      <RsvpButtons noite={noite} />
      {admin && (
        <>
          <button type="button" onClick={onEdit} className="rounded-md p-2 text-oat/50 hover:bg-cocoa-3 hover:text-oat" aria-label={`Editar ${noite.title}`}>
            <Pencil className="size-4" />
          </button>
          <DeleteNoite noite={noite} />
        </>
      )}
    </div>
  );
}

function DeleteNoite({ noite }: { noite: Noite }) {
  return (
    <button
      type="button"
      onClick={async () => {
        if (!confirm(`Desmarcar “${noite.title}”?${noite.weekly ? " Ela para de repetir toda semana." : ""}`)) return;
        try {
          await api(`/noites/${noite.id}`, { method: "DELETE" });
          window.dispatchEvent(new CustomEvent("cdg:events-changed", { detail: { server_id: noite.server_id } }));
        } catch (e) {
          toast(errorText(e));
        }
      }}
      className="rounded-md p-2 text-rust hover:bg-rust/15"
      aria-label={`Desmarcar ${noite.title}`}
    >
      <Trash2 className="size-4" />
    </button>
  );
}

function NoiteForm({ server, noite, onDone }: { server: Server; noite: Noite | null; onDone: () => void }) {
  const voices = server.channels.filter((c) => c.type === "voice");
  const texts = server.channels.filter((c) => c.type === "text");
  const [title, setTitle] = useState(noite?.title ?? "Noite da turma");
  const [description, setDescription] = useState(noite?.description ?? "");
  const [when, setWhen] = useState(() => localInput(noite ? new Date(noite.starts_at) : nextFriday()));
  const [duration, setDuration] = useState(noite?.duration_min ?? 180);
  const [weekly, setWeekly] = useState(noite?.weekly ?? true);
  const [voice, setVoice] = useState(noite?.voice_channel_id ?? voices[0]?.id ?? "");
  const [text, setText] = useState(noite?.text_channel_id ?? texts[0]?.id ?? "");
  const [activity, setActivity] = useState<Noite["activity"]>(noite?.activity ?? "papo");
  const [media, setMedia] = useState(noite?.media_url ?? "");
  const [remind, setRemind] = useState(noite?.remind_min ?? 30);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const needsMedia = activity === "watch" || activity === "dj";

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const at = new Date(when);
    if (Number.isNaN(at.getTime())) return setError("Escolha o dia e a hora.");
    setBusy(true);
    try {
      const body = {
        title,
        description,
        starts_at: at.toISOString(),
        duration_min: duration,
        weekly,
        voice_channel_id: voice,
        text_channel_id: text || null,
        activity,
        media_url: needsMedia ? media.trim() : "",
        remind_min: remind,
      };
      if (noite) await api(`/noites/${noite.id}`, { method: "PATCH", json: body });
      else await api(`/servers/${server.id}/noites`, { json: body });
      window.dispatchEvent(new CustomEvent("cdg:events-changed", { detail: { server_id: server.id } }));
      toast(noite ? "Noite atualizada" : "🎉 Noite marcada! A turma vai ser avisada.");
      onDone();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={(e) => void save(e)} className="mt-8 rounded-[18px] border border-ember/30 bg-cocoa-2 p-5">
      <div className="flex items-center gap-2">
        <h3 className="flex-1 font-display text-[22px]">{noite ? "Editar noite" : "Marcar uma noite"}</h3>
        <button type="button" onClick={onDone} className="rounded-md p-1.5 text-oat/50 hover:text-oat" aria-label="Fechar">
          <X className="size-4" />
        </button>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="block text-[13px] text-oat/60 sm:col-span-2">
          Nome
          <input className="field mt-1.5" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} required />
        </label>
        <label className="block text-[13px] text-oat/60">
          Quando
          <input type="datetime-local" className="field mt-1.5" value={when} onChange={(e) => setWhen(e.target.value)} required />
        </label>
        <label className="block text-[13px] text-oat/60">
          Duração
          <select className="field mt-1.5" value={duration} onChange={(e) => setDuration(Number(e.target.value))}>
            {[60, 90, 120, 180, 240, 300, 360].map((m) => (
              <option key={m} value={m}>
                {m % 60 ? `${Math.floor(m / 60)}h30` : `${m / 60} ${m === 60 ? "hora" : "horas"}`}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-[13px] text-oat/60">
          Sala de voz
          <select className="field mt-1.5" value={voice} onChange={(e) => setVoice(e.target.value)} required>
            {voices.map((c) => (
              <option key={c.id} value={c.id}>
                🔊 {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-[13px] text-oat/60">
          Avisos no canal
          <select className="field mt-1.5" value={text} onChange={(e) => setText(e.target.value)}>
            {texts.map((c) => (
              <option key={c.id} value={c.id}>
                #{c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-[13px] text-oat/60">
          O que vai rolar
          <select className="field mt-1.5" value={activity} onChange={(e) => setActivity(e.target.value as Noite["activity"])}>
            {(Object.keys(ACTIVITY) as Noite["activity"][]).map((k) => (
              <option key={k} value={k}>
                {ACTIVITY_ICON[k]} {ACTIVITY[k]}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-[13px] text-oat/60">
          Lembrete
          <select className="field mt-1.5" value={remind} onChange={(e) => setRemind(Number(e.target.value))}>
            <option value={0}>Sem lembrete</option>
            <option value={15}>15 min antes</option>
            <option value={30}>30 min antes</option>
            <option value={60}>1 hora antes</option>
            <option value={180}>3 horas antes</option>
            <option value={1440}>1 dia antes</option>
          </select>
        </label>
        {needsMedia && (
          <label className="block text-[13px] text-oat/60 sm:col-span-2">
            {activity === "dj" ? "Música ou playlist do YouTube" : "Vídeo do YouTube"} (começa sozinho quando a turma entrar)
            <input className="field mt-1.5" value={media} onChange={(e) => setMedia(e.target.value)} placeholder="https://www.youtube.com/watch?v=…" />
          </label>
        )}
        <label className="block text-[13px] text-oat/60 sm:col-span-2">
          Recado (opcional)
          <textarea className="field mt-1.5 min-h-[70px] resize-y" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={500} placeholder="Ex.: episódio 5 de Frieren, tragam pipoca" />
        </label>
        <label className="flex items-center gap-2 text-[14px] sm:col-span-2">
          <input type="checkbox" checked={weekly} onChange={(e) => setWeekly(e.target.checked)} className="size-4 accent-[var(--color-ember)]" />
          Repetir toda semana
        </label>
      </div>
      <FormError>{error}</FormError>
      <div className="mt-4 flex justify-end gap-2">
        <button type="button" onClick={onDone} className="h-10 rounded-[10px] px-4 text-[14px] font-semibold text-oat/60 hover:bg-cocoa-3">
          Cancelar
        </button>
        <button type="submit" disabled={busy || !voice} className="btn-ember h-10 px-5 text-[14px]">
          {noite ? "Salvar" : "Marcar noite"}
        </button>
      </div>
    </form>
  );
}

/* ------------------------------------------------------------------ */
/* Vídeo/música do evento: quem entra pelo aviso já encontra tocando    */
/* ------------------------------------------------------------------ */

let pendingMedia: { channelId: string; url: string; until: number } | null = null;

function startMedia(channelId: string, url: string, activity: Noite["activity"]) {
  if (url && (activity === "watch" || activity === "dj")) pendingMedia = { channelId, url, until: Date.now() + 60_000 };
}

/** Quando a call do evento conecta e ninguém pôs nada para tocar, começa o vídeo/música. */
function useEventMedia() {
  const v = useVoice();
  const connected = v.call.status === "connected";
  const playing = !!v.yt.state;
  const load = v.yt.load;
  useEffect(() => {
    const p = pendingMedia;
    if (!p || !connected || v.channelId !== p.channelId) return;
    if (Date.now() > p.until || playing) {
      pendingMedia = null;
      return;
    }
    // espera um pouco: se alguém já está tocando algo, o estado chega dos outros antes
    const t = window.setTimeout(() => {
      if (pendingMedia === p) {
        pendingMedia = null;
        load(p.url);
      }
    }, 2500);
    return () => window.clearTimeout(t);
  }, [connected, playing, v.channelId, load]);
}

/** Lembrete e "começou" da noite da turma (fica montado no app todo). */
export function NoiteAlert() {
  const [alert, setAlert] = useState<{ kind: "reminder" | "start"; d: Chamado } | null>(null);
  const v = useVoice();
  const router = useRouter();
  const joinVolume = v.prefs.joinVolume;
  const inRef = useRef(v.channelId);
  useEffect(() => {
    inRef.current = v.channelId;
  }, [v.channelId]);
  useEventMedia();

  useEffect(() => {
    const show = (kind: "reminder" | "start") => (e: Event) => {
      const d = (e as CustomEvent).detail as Chamado;
      if (kind === "start" && d.channel_id && inRef.current === d.channel_id) {
        startMedia(d.channel_id, d.media_url, d.activity);
        return; // já está na call
      }
      setAlert({ kind, d });
      chime("self", joinVolume);
      if (kind === "start") window.setTimeout(() => chime("ping", joinVolume), 450);
      try {
        if (document.hidden && "Notification" in window && Notification.permission === "granted") {
          const n = new Notification(kind === "start" ? `🎉 Começou: ${d.title}` : `⏰ Daqui a pouco: ${d.title}`, {
            body: kind === "start" ? `Entra na call ${d.channel_name} em ${d.server_name}!` : `${whenOf(d.starts_at)} na call ${d.channel_name} (${d.server_name})`,
            tag: `noite-${d.id}`,
          });
          n.onclick = () => {
            window.focus();
            router.push(`/app/s/${d.server_id}/${kind === "start" && d.channel_id ? d.channel_id : "noites"}`);
            n.close();
          };
        }
      } catch {
        /* sem notificações */
      }
    };
    const onReminder = show("reminder");
    const onStart = show("start");
    window.addEventListener("cdg:event-reminder", onReminder);
    window.addEventListener("cdg:event-start", onStart);
    return () => {
      window.removeEventListener("cdg:event-reminder", onReminder);
      window.removeEventListener("cdg:event-start", onStart);
    };
  }, [joinVolume, router]);

  useEffect(() => {
    if (!alert) return;
    const t = window.setTimeout(() => setAlert(null), alert.kind === "start" ? 90_000 : 45_000);
    return () => window.clearTimeout(t);
  }, [alert]);

  if (!alert) return null;
  const { d, kind } = alert;
  const channelId = d.channel_id;
  return (
    <div role="alert" className="slide-in fixed right-4 top-4 z-[66] w-[min(370px,calc(100vw-32px))] overflow-hidden rounded-[18px] bg-cocoa-0 shadow-[0_18px_50px_rgb(0_0_0/0.5)]">
      <div className="h-1.5 bg-gradient-to-r from-ember via-honey to-rust" />
      <div className="flex gap-3 p-4">
        <span className="grid size-11 shrink-0 place-items-center rounded-[14px] bg-ember/15 text-[22px]" aria-hidden>
          {kind === "start" ? "🎉" : "⏰"}
        </span>
        <div className="min-w-0 flex-1">
          <p className="label text-honey">Noite da turma · {d.server_name}</p>
          <p className="mt-1 text-[14.5px] leading-snug">
            {kind === "start" ? (
              <>
                Começou <b>{d.title}</b>! A turma está indo para <b>🔊 {d.channel_name}</b>
                {d.in_call > 0 ? ` (já tem ${d.in_call} lá)` : ""}.
              </>
            ) : (
              <>
                <b>{d.title}</b> começa às <b>{new Date(d.starts_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</b> em 🔊 {d.channel_name}.
                {d.going > 0 ? ` ${d.going} já ${d.going === 1 ? "confirmou" : "confirmaram"}.` : ""}
              </>
            )}
          </p>
          <div className="mt-3 flex gap-2">
            {kind === "start" && channelId ? (
              <button
                type="button"
                className="btn-ember inline-flex h-9 items-center gap-1.5 px-4 text-[13.5px]"
                onClick={() => {
                  router.push(`/app/s/${d.server_id}/${channelId}`);
                  startMedia(channelId, d.media_url, d.activity);
                  void v.join(channelId);
                  setAlert(null);
                  askNotifications();
                }}
              >
                <Volume2 className="size-4" /> Entrar na call
              </button>
            ) : (
              <button
                type="button"
                className="btn-ember inline-flex h-9 items-center gap-1.5 px-4 text-[13.5px]"
                onClick={async () => {
                  try {
                    await api(`/noites/${d.id}/rsvp`, { method: "PUT", json: { status: "vou" } });
                    toast("Fechado! Te avisamos quando começar.");
                  } catch (e) {
                    toast(errorText(e));
                  }
                  setAlert(null);
                  askNotifications();
                }}
              >
                Eu vou!
              </button>
            )}
            <button
              type="button"
              className="h-9 rounded-[10px] px-3 text-[13.5px] font-semibold text-oat/60 hover:bg-cocoa-3 hover:text-oat"
              onClick={() => {
                setAlert(null);
                askNotifications();
              }}
            >
              Agora não
            </button>
          </div>
        </div>
        <button type="button" onClick={() => setAlert(null)} className="self-start rounded-md p-1 text-oat/40 hover:text-oat" aria-label="Fechar aviso">
          <X className="size-4" />
        </button>
      </div>
    </div>
  );
}
