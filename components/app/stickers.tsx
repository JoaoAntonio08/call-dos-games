"use client";

import { useEffect, useRef, useState } from "react";
import { Bookmark, Loader2, Pencil, Plus, Search, Star, Trash2, X } from "lucide-react";
import { api, errorText, upload } from "@/lib/api";
import { useStore } from "@/lib/store";
import { toast } from "@/lib/ui";
import type { Attachment, Gif, Sticker } from "@/lib/types";

/* ------------------------------------------------------------------ */
/* coleção de figurinhas (fica em memória enquanto o app está aberto)  */
/* ------------------------------------------------------------------ */

let cache: Sticker[] | null = null;
const listeners = new Set<(s: Sticker[]) => void>();
function setCache(s: Sticker[]) {
  cache = s;
  listeners.forEach((f) => f(s));
}

function useStickers() {
  const [list, setList] = useState<Sticker[] | null>(cache);
  useEffect(() => {
    listeners.add(setList);
    if (!cache)
      api<Sticker[]>("/me/stickers")
        .then(setCache)
        .catch(() => setCache([]));
    return () => {
      listeners.delete(setList);
    };
  }, []);
  return list;
}

export async function saveSticker(fileId: string) {
  try {
    setCache(await api<Sticker[]>("/me/stickers/save", { json: { file_id: fileId } }));
    toast("Figurinha salva na sua coleção.");
  } catch (e) {
    toast(errorText(e));
  }
}

/* ------------------------------------------------------------------ */
/* painel: figurinhas e GIFs                                           */
/* ------------------------------------------------------------------ */

export function StickerPicker({ onSticker, onGif }: { onSticker: (s: Sticker) => void; onGif: (g: Gif) => void }) {
  const gifsOn = useStore((s) => s.features.gifs);
  const [tab, setTab] = useState<"stickers" | "gifs">("stickers");
  return (
    <div className="pop-in flex h-[420px] w-[min(380px,calc(100vw-16px))] flex-col rounded-[18px] bg-cocoa-0 p-3">
      <div className="mb-2 flex gap-1" role="tablist">
        {(
          [
            ["stickers", "Figurinhas"],
            ["gifs", "GIFs"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            className={`rounded-full px-3 py-1 text-[13px] font-semibold ${tab === id ? "bg-oat text-cocoa-0" : "text-oat/60 hover:text-oat"}`}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === "stickers" ? (
        <MyStickers onPick={onSticker} />
      ) : gifsOn ? (
        <GifSearch onPick={onGif} />
      ) : (
        <p className="m-auto max-w-[260px] text-center text-[13px] text-oat/55">
          A busca de GIFs ainda não está ligada no servidor da turma. Quem cuida do servidor precisa colocar a <b>GIPHY_API_KEY</b> no backend.
        </p>
      )}
    </div>
  );
}

const FAV = "\u0000fav";
const NEW_FOLDER = "\u0000nova";

function MyStickers({ onPick }: { onPick: (s: Sticker) => void }) {
  const list = useStickers();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState("");
  // "" = todas, FAV = favoritas, senão o nome da pasta
  const [view, setView] = useState("");
  const [editing, setEditing] = useState<string | null>(null);

  async function add(files: FileList) {
    setBusy(true);
    try {
      for (const f of Array.from(files).slice(0, 10)) {
        if (f.size > 3 * 1024 * 1024) {
          toast(`${f.name} passa de 3 MB.`);
          continue;
        }
        let next = await upload<Sticker[]>("/me/stickers", f);
        // subiu dentro de uma pasta: a figurinha nova já vai para ela
        if (view && view !== FAV && next[0]) next = await api<Sticker[]>(`/me/stickers/${next[0].id}`, { method: "PATCH", json: { folder: view } });
        setCache(next);
      }
    } catch (e) {
      toast(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  const folders = [...new Set((list ?? []).map((s) => s.folder || "").filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const hasFav = (list ?? []).some((s) => s.favorite);
  const needle = q.trim().toLowerCase();
  const shown = (list ?? [])
    .filter((s) => (view === FAV ? s.favorite : view ? s.folder === view : true))
    .filter((s) => !needle || s.name.toLowerCase().includes(needle))
    .sort((a, b) => Number(!!b.favorite) - Number(!!a.favorite));
  const edit = editing ? list?.find((s) => s.id === editing) : undefined;
  const tabs: [string, string][] = [["", "Todas"], ...(hasFav ? ([[FAV, "★ Favoritas"]] as [string, string][]) : []), ...folders.map((f) => [f, f] as [string, string])];

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {(list?.length ?? 0) > 0 && (
        <>
          <label className="flex h-9 shrink-0 items-center gap-2 rounded-[10px] bg-cocoa-3 px-3">
            <Search className="size-4 text-oat/40" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Buscar nas suas figurinhas"
              className="w-full bg-transparent text-[14px] outline-none placeholder:text-oat/30"
              aria-label="Buscar nas suas figurinhas"
            />
          </label>
          <div className="mt-2 flex shrink-0 gap-1 overflow-x-auto pb-1" role="tablist" aria-label="Pastas">
            {tabs.map(([id, label]) => (
              <button
                key={id || "todas"}
                type="button"
                role="tab"
                aria-selected={view === id}
                onClick={() => setView(id)}
                className={`shrink-0 rounded-full px-2.5 py-0.5 text-[12px] font-semibold ${view === id ? "bg-ember text-white" : "bg-cocoa-3 text-oat/60 hover:text-oat"}`}
              >
                {label}
              </button>
            ))}
          </div>
        </>
      )}
      <div className="mt-1 min-h-0 flex-1 overflow-y-auto">
        <div className="grid grid-cols-4 gap-1.5">
          <button
            type="button"
            onClick={() => input.current?.click()}
            disabled={busy}
            className="grid aspect-square place-items-center rounded-[12px] border-2 border-dashed border-oat/20 text-oat/50 hover:border-ember hover:text-ember"
            aria-label="Adicionar figurinha"
            title="Adicionar figurinha (GIF, WebP ou PNG, até 3 MB)"
          >
            {busy ? <Loader2 className="size-6 animate-spin" /> : <Plus className="size-6" />}
          </button>
          {shown.map((s) => (
            <div key={s.id} className="group relative aspect-square">
              <button
                type="button"
                onClick={() => onPick(s)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setEditing(s.id);
                }}
                className={`press size-full rounded-[12px] p-1 hover:bg-cocoa-3 ${editing === s.id ? "bg-cocoa-3 ring-2 ring-ember" : ""}`}
                aria-label={`Mandar figurinha ${s.name}`}
                title={`${s.name} (botão direito para editar)`}
              >
                <img src={s.url} alt={s.name} loading="lazy" className="size-full object-contain" />
              </button>
              {s.favorite && <Star aria-hidden className="pointer-events-none absolute left-0.5 top-0.5 size-3.5 fill-honey text-honey" />}
              <button
                type="button"
                onClick={() => setEditing(editing === s.id ? null : s.id)}
                aria-label={`Editar figurinha ${s.name}`}
                className="absolute -right-1 -top-1 hidden size-5 place-items-center rounded-full bg-cocoa-5 text-oat group-focus-within:grid group-hover:grid"
              >
                <Pencil className="size-3" />
              </button>
            </div>
          ))}
        </div>
        {list && list.length === 0 && (
          <p className="mt-4 text-center text-[13px] text-oat/50">Sua coleção está vazia. Clique no + para subir figurinhas (GIFs animados funcionam), ou salve as que a turma mandar.</p>
        )}
        {list && list.length > 0 && shown.length === 0 && <p className="mt-4 text-center text-[13px] text-oat/50">Nenhuma figurinha aqui.</p>}
      </div>
      {edit && <StickerEditor key={edit.id} s={edit} folders={folders} onClose={() => setEditing(null)} />}
      <input ref={input} type="file" accept="image/gif,image/webp,image/png,image/jpeg" multiple hidden onChange={(e) => e.target.files && void add(e.target.files)} />
    </div>
  );
}

function StickerEditor({ s, folders, onClose }: { s: Sticker; folders: string[]; onClose: () => void }) {
  const [name, setName] = useState(s.name);
  const [folder, setFolder] = useState(s.folder ?? "");
  const [newFolder, setNewFolder] = useState(false);

  async function patch(body: { name?: string; favorite?: boolean; folder?: string }) {
    try {
      setCache(await api<Sticker[]>(`/me/stickers/${s.id}`, { method: "PATCH", json: body }));
      return true;
    } catch (e) {
      toast(errorText(e));
      return false;
    }
  }

  return (
    <form
      className="mt-2 shrink-0 space-y-2 rounded-[12px] bg-cocoa-3 p-2.5"
      aria-label={`Editar figurinha ${s.name}`}
      onSubmit={(e) => {
        e.preventDefault();
        void patch({ name: name.trim() || s.name, folder: folder.trim() }).then((ok) => ok && onClose());
      }}
    >
      <div className="flex items-center gap-2">
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} className="field h-9 flex-1 text-[13.5px]" aria-label="Nome da figurinha" />
        <button
          type="button"
          onClick={() => void patch({ favorite: !s.favorite })}
          aria-pressed={!!s.favorite}
          aria-label={s.favorite ? "Tirar das favoritas" : "Favoritar"}
          title={s.favorite ? "Tirar das favoritas" : "Favoritar"}
          className="grid size-9 shrink-0 place-items-center rounded-[9px] hover:bg-cocoa-5"
        >
          <Star className={`size-4 ${s.favorite ? "fill-honey text-honey" : "text-oat/60"}`} />
        </button>
        <button
          type="button"
          onClick={async () => {
            try {
              setCache(await api<Sticker[]>(`/me/stickers/${s.id}`, { method: "DELETE" }));
              onClose();
            } catch (e) {
              toast(errorText(e));
            }
          }}
          aria-label={`Apagar figurinha ${s.name}`}
          title="Apagar"
          className="grid size-9 shrink-0 place-items-center rounded-[9px] text-rust hover:bg-rust/15"
        >
          <Trash2 className="size-4" />
        </button>
      </div>
      <div className="flex items-center gap-2">
        {newFolder ? (
          <input value={folder} onChange={(e) => setFolder(e.target.value)} maxLength={24} placeholder="Nome da pasta nova" className="field h-9 flex-1 text-[13.5px]" aria-label="Nome da pasta nova" autoFocus />
        ) : (
          <select
            value={folder}
            onChange={(e) => {
              if (e.target.value === NEW_FOLDER) {
                setNewFolder(true);
                setFolder("");
              } else setFolder(e.target.value);
            }}
            className="field h-9 flex-1 py-0 text-[13.5px]"
            aria-label="Pasta"
          >
            <option value="">Sem pasta</option>
            {folders.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
            <option value={NEW_FOLDER}>+ Pasta nova…</option>
          </select>
        )}
        <button type="submit" className="btn-ember h-9 shrink-0 px-3 text-[13px]">
          Salvar
        </button>
        <button type="button" onClick={onClose} aria-label="Fechar edição" className="grid size-9 shrink-0 place-items-center rounded-[9px] text-oat/60 hover:bg-cocoa-5">
          <X className="size-4" />
        </button>
      </div>
    </form>
  );
}

function GifSearch({ onPick }: { onPick: (g: Gif) => void }) {
  const [q, setQ] = useState("");
  const [items, setItems] = useState<Gif[] | null>(null);
  const [error, setError] = useState("");
  const [kind, setKind] = useState<"gifs" | "stickers">("gifs");

  useEffect(() => {
    let alive = true;
    const t = window.setTimeout(() => {
      setError("");
      api<Gif[]>(`/gifs?kind=${kind}&q=${encodeURIComponent(q.trim())}`)
        .then((r) => alive && setItems(r))
        .catch((e) => alive && (setItems([]), setError(errorText(e))));
    }, q ? 400 : 0);
    return () => {
      alive = false;
      window.clearTimeout(t);
    };
  }, [q, kind]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex gap-1.5">
        <label className="flex h-9 flex-1 items-center gap-2 rounded-[10px] bg-cocoa-3 px-3">
          <Search className="size-4 text-oat/40" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar no GIPHY" className="w-full bg-transparent text-[14px] outline-none placeholder:text-oat/30" autoFocus />
        </label>
        <button
          type="button"
          onClick={() => setKind((k) => (k === "gifs" ? "stickers" : "gifs"))}
          className="h-9 rounded-[10px] bg-cocoa-3 px-2.5 text-[12px] font-semibold text-oat/70 hover:text-oat"
          title="Alternar entre GIFs e figurinhas do GIPHY"
        >
          {kind === "gifs" ? "GIFs" : "Figurinhas"}
        </button>
      </div>
      <div className="mt-2 min-h-0 flex-1 overflow-y-auto">
        {error && <p className="mt-6 text-center text-[13px] text-oat/55">{error}</p>}
        {items === null && <Loader2 className="mx-auto mt-10 size-6 animate-spin text-oat/40" />}
        <div className="columns-2 gap-1.5">
          {items?.map((g) => (
            <button key={g.id} type="button" onClick={() => onPick(g)} className="press mb-1.5 block w-full overflow-hidden rounded-[10px] bg-cocoa-3" title={g.title}>
              <img src={g.preview} alt={g.title} loading="lazy" className="w-full" style={{ aspectRatio: `${g.width} / ${g.height}` }} />
            </button>
          ))}
        </div>
      </div>
      <p className="pt-1.5 text-right text-[10.5px] font-semibold uppercase tracking-wider text-oat/35">Powered by GIPHY</p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* no chat                                                             */
/* ------------------------------------------------------------------ */

export function StickerView({ a, mine }: { a: Attachment; mine: boolean }) {
  const list = useStickers();
  const have = !!list?.some((s) => s.file_id === a.id);
  return (
    <div className="group relative">
      <img src={a.url} alt={`Figurinha ${a.name}`} loading="lazy" className="size-[160px] object-contain" />
      {!mine && !have && a.id && (
        <button
          type="button"
          onClick={() => void saveSticker(a.id!)}
          className="absolute right-1 top-1 hidden items-center gap-1 rounded-full bg-cocoa-0/85 px-2 py-1 text-[11.5px] font-semibold text-oat group-hover:flex"
        >
          <Bookmark className="size-3.5" /> Salvar
        </button>
      )}
    </div>
  );
}

export function GifView({ a }: { a: Attachment }) {
  const w = a.width ?? 240;
  const h = a.height ?? 180;
  const scale = Math.min(1, 300 / w, 260 / h);
  return (
    <img
      src={a.url}
      alt={a.name}
      loading="lazy"
      referrerPolicy="no-referrer"
      className="rounded-[12px] bg-cocoa-2"
      style={{ width: Math.round(w * scale), maxWidth: "100%", aspectRatio: `${w} / ${h}` }}
    />
  );
}
