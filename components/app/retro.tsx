"use client";

import { useEffect, useState } from "react";
import { CalendarDays } from "lucide-react";
import { api, errorText } from "@/lib/api";
import { useUI } from "@/lib/ui";
import type { Server, User } from "@/lib/types";
import { Avatar } from "./bits";

/* ------------------------------------------------------------------ */
/* Retrospectiva do mês: quem mais ficou em call, transmitiu, falou,    */
/* ganhou nos minigames; as músicas e o emoji do mês.                   */
/* (Mensagens só dos canais abertos a todos; nada de canal privado.)    */
/* ------------------------------------------------------------------ */

interface Row {
  user: User;
  value: number;
}
interface Retro {
  month: string;
  messages: { total: number; top: Row[] };
  emojis: { emoji: string; value: number }[];
  star: { id: string; channel_id: string; user: User | null; content: string; value: number } | null;
  call: Row[];
  share: Row[];
  watch: Row[];
  games: Row[];
  call_total: number;
  songs: { video_id: string; title: string; author: string; value: number }[];
  me: { messages: number; call_seconds: number; share_seconds: number; watch_seconds: number; games_won: number };
}

const MONTHS = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

function lastMonths(n: number): string[] {
  const d = new Date();
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    const m = new Date(d.getFullYear(), d.getMonth() - i, 1);
    out.push(`${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, "0")}`);
  }
  return out;
}
const monthName = (m: string) => `${MONTHS[Number(m.slice(5)) - 1]} de ${m.slice(0, 4)}`;
const hours = (s: number) => (s >= 3600 ? `${(s / 3600).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} h` : `${Math.round(s / 60)} min`);

export function RetroView({ server }: { server: Server }) {
  const [months] = useState(() => lastMonths(6));
  const [month, setMonth] = useState(months[0]);
  const [data, setData] = useState<Retro | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    api<Retro>(`/servers/${server.id}/retrospectiva?mes=${month}`)
      .then((r) => {
        if (!alive) return;
        setData(r);
        setError("");
      })
      .catch((e) => alive && setError(errorText(e)));
    return () => {
      alive = false;
    };
  }, [server.id, month]);

  const shown = data?.month === month ? data : null;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex h-12 shrink-0 items-center gap-2.5 border-b border-cocoa-0/50 px-3 sm:px-4">
        <button type="button" onClick={() => useUI.setState({ navOpen: true })} className="press -ml-1 rounded-md p-1.5 text-oat/60 md:hidden" aria-label="Abrir menu">
          <CalendarDays className="size-5" />
        </button>
        <CalendarDays className="hidden size-5 text-ember-2 md:block" />
        <h1 className="font-semibold">Retrospectiva</h1>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[860px] px-4 pb-16 pt-8 sm:px-8">
          <p className="label text-ember-2">{server.name}</p>
          <h2 className="mt-2 font-display text-[clamp(34px,5vw,52px)] leading-[0.95]">Como foi {monthName(month).split(" de ")[0]}</h2>
          <div className="mt-4 flex flex-wrap gap-1.5">
            {months.map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMonth(m)}
                className={`press rounded-full px-3 py-1 text-[13px] font-semibold ${m === month ? "bg-oat text-cocoa-0" : "bg-cocoa-3 text-oat/60 hover:bg-cocoa-4"}`}
              >
                {monthName(m)}
              </button>
            ))}
          </div>

          {error && <p className="mt-8 text-[14px] text-ember-2">{error}</p>}
          {!shown && !error && <p className="mt-10 text-[14px] text-oat/40">Juntando o mês…</p>}
          {shown && <RetroBody data={shown} />}
        </div>
      </div>
    </div>
  );
}

function RetroBody({ data }: { data: Retro }) {
  const empty = !data.call_total && !data.messages.total && !data.songs.length;
  if (empty) return <p className="mt-10 text-[15px] text-oat/50">Esse mês ficou em silêncio. Bora marcar uma call?</p>;
  return (
    <>
      <div className="mt-8 grid gap-3 sm:grid-cols-3">
        <Big label="em call, somando todo mundo" value={hours(data.call_total)} />
        <Big label="mensagens nos canais abertos" value={data.messages.total.toLocaleString("pt-BR")} />
        <Big label="emoji do mês" value={data.emojis[0]?.emoji ?? "—"} />
      </div>

      <section className="mt-8 rounded-[14px] bg-cocoa-3 p-4">
        <h3 className="label text-ember-2">Você no mês</h3>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-5">
          <Small label="em call" value={hours(data.me.call_seconds)} />
          <Small label="transmitindo" value={hours(data.me.share_seconds)} />
          <Small label="assistindo" value={hours(data.me.watch_seconds)} />
          <Small label="mensagens" value={String(data.me.messages)} />
          <Small label="vitórias nos jogos" value={String(data.me.games_won)} />
        </div>
      </section>

      <div className="mt-8 grid gap-6 sm:grid-cols-2">
        <Board title="Mais tempo em call" rows={data.call} fmt={hours} />
        <Board title="Mais falou no chat" rows={data.messages.top} fmt={(n) => `${n} msg`} />
        <Board title="Mais transmitiu a tela" rows={data.share} fmt={hours} />
        <Board title="Mais assistiu a tela da turma" rows={data.watch} fmt={hours} />
        <Board title="Mais vitórias nos minigames" rows={data.games} fmt={(n) => `${n} ${n === 1 ? "vitória" : "vitórias"}`} />
        {data.songs.length > 0 && (
          <section>
            <h3 className="label text-oat/45">Mais tocadas na call</h3>
            <ol className="mt-3 space-y-2">
              {data.songs.map((s, i) => (
                <li key={s.video_id} className="flex items-center gap-3">
                  <span className="w-5 text-right font-display text-[18px] text-oat/40">{i + 1}</span>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`https://i.ytimg.com/vi/${encodeURIComponent(s.video_id)}/mqdefault.jpg`} alt="" className="h-[34px] w-[60px] shrink-0 rounded-[6px] object-cover" loading="lazy" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px]">{s.title}</span>
                    <span className="block truncate text-[12px] text-oat/45">
                      {s.author} · {s.value}×
                    </span>
                  </span>
                </li>
              ))}
            </ol>
          </section>
        )}
      </div>

      {data.star && data.star.user && (
        <section className="mt-8 rounded-[14px] bg-cocoa-3 p-4">
          <h3 className="label text-ember-2">Mensagem do mês · {data.star.value} reações</h3>
          <div className="mt-3 flex gap-3">
            <Avatar name={data.star.user.display_name} avatar={data.star.user.avatar ?? null} size={36} />
            <div className="min-w-0">
              <p className="text-[14px] font-semibold">{data.star.user.display_name}</p>
              <p className="whitespace-pre-wrap break-words text-[14.5px] text-oat/85">{data.star.content || "(anexo)"}</p>
            </div>
          </div>
        </section>
      )}

      {data.emojis.length > 1 && (
        <p className="mt-6 text-[14px] text-oat/55">
          Reações mais usadas:{" "}
          {data.emojis.map((e) => (
            <span key={e.emoji} className="mr-2 whitespace-nowrap">
              <span className="text-[18px]">{e.emoji}</span> {e.value}
            </span>
          ))}
        </p>
      )}
    </>
  );
}

function Big({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[14px] bg-cocoa-3 px-4 py-4">
      <p className="font-display text-[34px] font-bold leading-none">{value}</p>
      <p className="mt-1.5 text-[13px] text-oat/55">{label}</p>
    </div>
  );
}

function Small({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="font-display text-[22px] font-bold leading-none">{value}</p>
      <p className="mt-1 text-[12px] text-oat/55">{label}</p>
    </div>
  );
}

function Board({ title, rows, fmt }: { title: string; rows: Row[]; fmt: (n: number) => string }) {
  if (!rows.length) return null;
  return (
    <section>
      <h3 className="label text-oat/45">{title}</h3>
      <ol className="mt-3 space-y-2">
        {rows.map((r, i) => (
          <li key={r.user.id} className="flex items-center gap-3">
            <span className="w-5 text-right font-display text-[18px] text-oat/40">{i === 0 ? "👑" : i + 1}</span>
            <Avatar name={r.user.display_name} avatar={r.user.avatar ?? null} size={30} />
            <span className="min-w-0 flex-1 truncate text-[14px]">{r.user.display_name}</span>
            <span className="shrink-0 text-[13px] tabular-nums text-oat/60">{fmt(r.value)}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
