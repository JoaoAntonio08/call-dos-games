"use client";

import { useEffect, useState } from "react";
import { Check, Minus, Pencil, Plus, Trash2, TvMinimalPlay } from "lucide-react";
import { api, errorText } from "@/lib/api";
import { loadShows, setShows, useStore, useUser } from "@/lib/store";
import { toast, useUI } from "@/lib/ui";
import { agoOf } from "@/lib/format";
import type { Server, Show, ShowKind, ShowStatus, User } from "@/lib/types";

/* ------------------------------------------------------------------ */
/* Onde paramos: a lista do que a turma está assistindo/jogando         */
/* ------------------------------------------------------------------ */

const KINDS: { id: ShowKind; label: string }[] = [
  { id: "anime", label: "Anime" },
  { id: "serie", label: "Série" },
  { id: "filme", label: "Filme" },
  { id: "jogo", label: "Jogo" },
  { id: "outro", label: "Outro" },
];
const STATUSES: { id: ShowStatus; label: string; empty: string }[] = [
  { id: "watching", label: "Assistindo", empty: "Nada em andamento." },
  { id: "paused", label: "Pausado", empty: "" },
  { id: "planned", label: "Quero ver", empty: "" },
  { id: "done", label: "Terminado", empty: "" },
];
const unit = (k: ShowKind) => (k === "jogo" ? "parte" : k === "filme" ? "filme" : "ep");

async function save(serverId: string, path: string, method: string, json?: unknown) {
  try {
    setShows(serverId, await api<Show[]>(path, { method, json }));
    return true;
  } catch (e) {
    toast(errorText(e));
    return false;
  }
}

export function ShowsView({ server }: { server: Server }) {
  const shows = useStore((s) => s.shows[server.id]);
  const [showDone, setShowDone] = useState(false);

  useEffect(() => {
    void loadShows(server.id).catch((e) => toast(errorText(e)));
  }, [server.id]);

  const by = (st: ShowStatus) => (shows ?? []).filter((s) => s.status === st);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex h-12 shrink-0 items-center gap-2.5 border-b border-cocoa-0/50 px-3 sm:px-4">
        <button type="button" onClick={() => useUI.setState({ navOpen: true })} className="press -ml-1 rounded-md p-1.5 text-oat/60 md:hidden" aria-label="Abrir menu">
          <TvMinimalPlay className="size-5" />
        </button>
        <TvMinimalPlay className="hidden size-5 text-ember-2 md:block" />
        <h1 className="font-semibold">Onde paramos</h1>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[860px] px-4 pb-16 pt-8 sm:px-8">
          <p className="label text-ember-2">{server.name}</p>
          <h2 className="mt-2 font-display text-[clamp(34px,5vw,52px)] leading-[0.95]">Onde a gente parou?</h2>
          <p className="mt-3 max-w-[520px] text-[15px] leading-relaxed text-oat/55">
            O anime, a série ou o jogo da turma, com o episódio em que vocês pararam. Acabou o episódio, aperta o +1 e ninguém esquece.
          </p>

          <AddShow serverId={server.id} />

          {!shows ? (
            <p className="mt-10 text-[14px] text-oat/40">Abrindo a lista…</p>
          ) : (
            STATUSES.map((st) => {
              const list = by(st.id);
              if (st.id === "done") {
                if (!list.length) return null;
                return (
                  <section key={st.id} className="mt-10">
                    <button type="button" onClick={() => setShowDone(!showDone)} className="label flex items-center gap-2 text-oat/45 hover:text-oat/80">
                      {st.label} · {list.length} <span aria-hidden>{showDone ? "▾" : "▸"}</span>
                    </button>
                    {showDone && (
                      <ul className="mt-3 divide-y divide-oat/[0.06]">
                        {list.map((s) => (
                          <ShowRow key={s.id} show={s} serverId={server.id} />
                        ))}
                      </ul>
                    )}
                  </section>
                );
              }
              if (!list.length && !st.empty) return null;
              return (
                <section key={st.id} className="mt-10">
                  <h3 className="label text-oat/45">
                    {st.label} · {list.length}
                  </h3>
                  {list.length ? (
                    <ul className="mt-3 divide-y divide-oat/[0.06]">
                      {list.map((s) => (
                        <ShowRow key={s.id} show={s} serverId={server.id} />
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-3 text-[14px] text-oat/40">{st.empty} Adiciona aí em cima o que vocês começaram.</p>
                  )}
                </section>
              );
            })
          )}

          <SeenInCall serverId={server.id} />
        </div>
      </div>
    </div>
  );
}

interface Seen {
  video_id: string;
  title: string;
  author: string;
  times: number;
  last_at: string;
  by: User[];
}

/** O que tocou no YouTube das calls (últimos 60 dias): aparece sozinho, dá para pôr na lista. */
function SeenInCall({ serverId }: { serverId: string }) {
  const [list, setList] = useState<Seen[] | null>(null);
  const [all, setAll] = useState(false);
  useEffect(() => {
    let alive = true;
    api<Seen[]>(`/servers/${serverId}/visto-na-call`)
      .then((r) => alive && setList(r))
      .catch(() => alive && setList([]));
    return () => {
      alive = false;
    };
  }, [serverId]);
  if (!list?.length) return null;
  const shown = all ? list : list.slice(0, 8);
  return (
    <section className="mt-12">
      <h3 className="label text-oat/45">Visto na call · {list.length}</h3>
      <p className="mt-1 text-[13px] text-oat/40">Os vídeos que vocês assistiram juntos no YouTube da call, nos últimos 60 dias.</p>
      <ul className="mt-3 divide-y divide-oat/[0.06]">
        {shown.map((v) => (
          <li key={v.video_id} className="flex items-center gap-3 py-2.5">
            <a href={`https://www.youtube.com/watch?v=${encodeURIComponent(v.video_id)}`} target="_blank" rel="noreferrer noopener" className="shrink-0 overflow-hidden rounded-[8px]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`https://i.ytimg.com/vi/${encodeURIComponent(v.video_id)}/mqdefault.jpg`} alt="" className="h-[45px] w-[80px] object-cover" loading="lazy" />
            </a>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[14.5px] font-medium">{v.title || "Vídeo do YouTube"}</p>
              <p className="truncate text-[12.5px] text-oat/45">
                {v.author}
                {v.times > 1 ? ` · tocou ${v.times}×` : ""} · {agoOf(v.last_at)}
                {v.by.length ? ` · por ${v.by.map((u) => u.display_name).join(", ")}` : ""}
              </p>
            </div>
            <button
              type="button"
              onClick={() => void save(serverId, `/servers/${serverId}/shows`, "POST", { title: (v.title || "Vídeo do YouTube").slice(0, 120), kind: "outro", status: "done" }).then((ok) => ok && toast("Foi para a lista, em Terminado."))}
              className="press shrink-0 rounded-full px-2.5 py-1 text-[12.5px] font-semibold text-ember-2 hover:bg-cocoa-3"
            >
              Pôr na lista
            </button>
          </li>
        ))}
      </ul>
      {list.length > 8 && (
        <button type="button" onClick={() => setAll(!all)} className="mt-2 text-[13px] font-semibold text-oat/50 hover:text-oat">
          {all ? "Mostrar menos" : `Ver todos (${list.length})`}
        </button>
      )}
    </section>
  );
}

function AddShow({ serverId }: { serverId: string }) {
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<ShowKind>("anime");
  const [total, setTotal] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setBusy(true);
    const n = parseInt(total, 10);
    const ok = await save(serverId, `/servers/${serverId}/shows`, "POST", {
      title,
      kind,
      status: "watching",
      ...(n > 0 ? { total: n } : {}),
    });
    setBusy(false);
    if (ok) {
      setTitle("");
      setTotal("");
    }
  }

  return (
    <form onSubmit={submit} className="mt-7 flex flex-wrap items-stretch gap-2 rounded-[14px] bg-cocoa-2 p-2">
      <input
        className="field h-11 min-w-[200px] flex-[3] !bg-cocoa-0"
        placeholder="Frieren, Severance, Elden Ring…"
        value={title}
        maxLength={120}
        onChange={(e) => setTitle(e.target.value)}
        aria-label="Nome"
      />
      <select className="field h-11 !w-auto flex-1 !bg-cocoa-0" value={kind} onChange={(e) => setKind(e.target.value as ShowKind)} aria-label="Tipo">
        {KINDS.map((k) => (
          <option key={k.id} value={k.id}>
            {k.label}
          </option>
        ))}
      </select>
      <input
        className="field h-11 !w-32 flex-none !bg-cocoa-0"
        inputMode="numeric"
        placeholder="Total de eps"
        value={total}
        onChange={(e) => setTotal(e.target.value.replace(/\D/g, "").slice(0, 5))}
        aria-label="Total de episódios (opcional)"
      />
      <button type="submit" disabled={busy || !title.trim()} className="btn-ember flex h-11 items-center gap-1.5 px-4 text-[14px]">
        <Plus className="size-4" /> Adicionar
      </button>
    </form>
  );
}

function ShowRow({ show, serverId }: { show: Show; serverId: string }) {
  const [editing, setEditing] = useState(false);
  const [bump, setBump] = useState(0);
  const who = useUser(show.updated_by ?? undefined);
  const pct = show.total ? Math.min(100, (show.episode / show.total) * 100) : null;
  const u = unit(show.kind);

  async function step(d: number) {
    const episode = Math.max(0, show.episode + d);
    if (d > 0) setBump((n) => n + 1);
    const finished = show.total && episode >= show.total && show.status !== "done";
    await save(serverId, `/shows/${show.id}`, "PATCH", { episode, ...(show.status !== "watching" && !finished ? { status: "watching" } : {}) });
    if (finished) toast(`Fim de ${show.title}! Marque como terminado se for isso mesmo.`);
  }

  if (editing) return <EditShow show={show} serverId={serverId} onDone={() => setEditing(false)} />;

  return (
    <li className="group flex items-center gap-4 py-4">
      <div className="min-w-0 flex-1">
        <p className="flex items-baseline gap-2">
          <span className="truncate font-display text-[21px] leading-tight">{show.title}</span>
          <span className="label shrink-0 text-oat/35">{KINDS.find((k) => k.id === show.kind)?.label}</span>
        </p>
        <p className="mt-1 text-[13.5px] text-oat/55">
          {show.season ? `T${show.season} · ` : ""}
          {show.episode === 0 ? (show.status === "planned" ? "ainda não começou" : `nenhum ${u} ainda`) : `parou no ${u} ${show.episode}`}
          {show.total ? ` de ${show.total}` : ""}
          {who && <span className="text-oat/35"> · {who.display_name} atualizou {agoOf(show.updated_at)}</span>}
        </p>
        {pct !== null && (
          <div className="mt-2 h-1 max-w-[320px] overflow-hidden rounded-full bg-cocoa-0">
            <div className="h-full rounded-full bg-ember transition-[width] duration-500" style={{ width: `${pct}%` }} />
          </div>
        )}
        {show.note && <p className="mt-1.5 text-[13px] italic text-oat/45">“{show.note}”</p>}
      </div>

      <div className="flex shrink-0 items-center gap-1">
        <button type="button" onClick={() => setEditing(true)} aria-label="Editar" title="Editar" className="press grid size-9 place-items-center rounded-[10px] text-oat/40 opacity-0 hover:bg-cocoa-4 hover:text-oat focus-visible:opacity-100 group-hover:opacity-100">
          <Pencil className="size-4" />
        </button>
        {show.status !== "done" && (
          <>
            <button type="button" onClick={() => void step(-1)} disabled={show.episode === 0} aria-label={`Voltar um ${u}`} className="press grid size-9 place-items-center rounded-[10px] text-oat/50 hover:bg-cocoa-4 hover:text-oat disabled:opacity-30">
              <Minus className="size-4" />
            </button>
            <button
              type="button"
              onClick={() => void step(1)}
              className="press relative flex h-10 items-center gap-1 rounded-[11px] bg-ember px-3.5 text-[14px] font-bold text-white hover:bg-ember-2"
              title={`Vimos mais um ${u}`}
            >
              +1 {u}
              {bump > 0 && (
                <span key={bump} aria-hidden className="float-up pointer-events-none absolute -top-2 right-1 text-[13px] font-bold text-ember-2">
                  +1
                </span>
              )}
            </button>
          </>
        )}
      </div>
    </li>
  );
}

function EditShow({ show, serverId, onDone }: { show: Show; serverId: string; onDone: () => void }) {
  const [f, setF] = useState({
    title: show.title,
    kind: show.kind,
    status: show.status,
    season: show.season?.toString() ?? "",
    episode: show.episode.toString(),
    total: show.total?.toString() ?? "",
    note: show.note,
  });
  const num = (v: string) => v.replace(/\D/g, "").slice(0, 5);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const ok = await save(serverId, `/shows/${show.id}`, "PATCH", {
      title: f.title,
      kind: f.kind,
      status: f.status,
      episode: parseInt(f.episode || "0", 10),
      note: f.note,
      ...(f.season ? { season: parseInt(f.season, 10) } : { clear_season: true }),
      ...(f.total ? { total: parseInt(f.total, 10) } : { clear_total: true }),
    });
    if (ok) onDone();
  }

  async function remove() {
    if (!confirm(`Tirar ${show.title} da lista?`)) return;
    await save(serverId, `/shows/${show.id}`, "DELETE");
  }

  return (
    <li className="py-4">
      <form onSubmit={submit} className="grid gap-2 rounded-[14px] border border-oat/[0.08] bg-cocoa-2 p-3 sm:grid-cols-6">
        <input className="field h-10 sm:col-span-4" value={f.title} maxLength={120} onChange={(e) => setF({ ...f, title: e.target.value })} aria-label="Nome" />
        <select className="field h-10 sm:col-span-2" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as ShowKind })} aria-label="Tipo">
          {KINDS.map((k) => (
            <option key={k.id} value={k.id}>
              {k.label}
            </option>
          ))}
        </select>
        <label className="text-[12px] text-oat/50 sm:col-span-2">
          Temporada
          <input className="field mt-1 h-10" inputMode="numeric" value={f.season} onChange={(e) => setF({ ...f, season: num(e.target.value) })} />
        </label>
        <label className="text-[12px] text-oat/50 sm:col-span-2">
          Parou no
          <input className="field mt-1 h-10" inputMode="numeric" value={f.episode} onChange={(e) => setF({ ...f, episode: num(e.target.value) })} />
        </label>
        <label className="text-[12px] text-oat/50 sm:col-span-2">
          Total
          <input className="field mt-1 h-10" inputMode="numeric" value={f.total} onChange={(e) => setF({ ...f, total: num(e.target.value) })} />
        </label>
        <input className="field h-10 sm:col-span-6" placeholder="Nota (ex.: parou no meio, minuto 12)" value={f.note} maxLength={300} onChange={(e) => setF({ ...f, note: e.target.value })} />
        <div className="flex flex-wrap gap-1 sm:col-span-6">
          {STATUSES.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setF({ ...f, status: s.id })}
              className={`press h-8 rounded-full px-3 text-[13px] font-semibold ${f.status === s.id ? "bg-oat text-cocoa-0" : "bg-cocoa-0 text-oat/60 hover:text-oat"}`}
            >
              {s.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 pt-1 sm:col-span-6">
          <button type="button" onClick={() => void remove()} className="press flex h-9 items-center gap-1.5 rounded-[10px] px-3 text-[13px] text-[#ff8f92] hover:bg-rust hover:text-oat">
            <Trash2 className="size-4" /> Tirar da lista
          </button>
          <span className="flex-1" />
          <button type="button" onClick={onDone} className="btn-quiet h-9 px-3.5 text-[13.5px]">
            Cancelar
          </button>
          <button type="submit" className="btn-ember flex h-9 items-center gap-1.5 px-3.5 text-[13.5px]">
            <Check className="size-4" /> Salvar
          </button>
        </div>
      </form>
    </li>
  );
}
