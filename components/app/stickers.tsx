"use client";

import { useEffect, useRef, useState } from "react";
import { Bookmark, Loader2, Plus, Search, X } from "lucide-react";
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

function MyStickers({ onPick }: { onPick: (s: Sticker) => void }) {
  const list = useStickers();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  async function add(files: FileList) {
    setBusy(true);
    try {
      for (const f of Array.from(files).slice(0, 10)) {
        if (f.size > 3 * 1024 * 1024) {
          toast(`${f.name} passa de 3 MB.`);
          continue;
        }
        setCache(await upload<Sticker[]>("/me/stickers", f));
      }
    } catch (e) {
      toast(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  async function remove(s: Sticker) {
    try {
      setCache(await api<Sticker[]>(`/me/stickers/${s.id}`, { method: "DELETE" }));
    } catch (e) {
      toast(errorText(e));
    }
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
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
        {list?.map((s) => (
          <div key={s.id} className="group relative aspect-square">
            <button type="button" onClick={() => onPick(s)} className="press size-full rounded-[12px] p-1 hover:bg-cocoa-3" aria-label={`Mandar figurinha ${s.name}`} title={s.name}>
              <img src={s.url} alt={s.name} loading="lazy" className="size-full object-contain" />
            </button>
            <button
              type="button"
              onClick={() => void remove(s)}
              aria-label={`Apagar figurinha ${s.name}`}
              className="absolute -right-1 -top-1 hidden size-5 place-items-center rounded-full bg-rust text-oat group-hover:grid"
            >
              <X className="size-3" />
            </button>
          </div>
        ))}
      </div>
      {list && list.length === 0 && (
        <p className="mt-4 text-center text-[13px] text-oat/50">Sua coleção está vazia. Clique no + para subir figurinhas (GIFs animados funcionam), ou salve as que a turma mandar.</p>
      )}
      <input ref={input} type="file" accept="image/gif,image/webp,image/png,image/jpeg" multiple hidden onChange={(e) => e.target.files && void add(e.target.files)} />
    </div>
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
