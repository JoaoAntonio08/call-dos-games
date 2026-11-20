"use client";

import { useState } from "react";
import { ChevronUp, ListPlus, Play, X } from "lucide-react";
import { api, errorText } from "@/lib/api";
import { setQueue, useStore, useUser } from "@/lib/store";
import { toast } from "@/lib/ui";
import { useVoice } from "@/lib/voice";
import { parseYouTube } from "@/lib/use-youtube-sync";
import type { QueueItem } from "@/lib/types";

/* ------------------------------------------------------------------ */
/* YouTube junto + fila votada: o mais votado toca quando o vídeo acaba */
/* ------------------------------------------------------------------ */

export function QueuePanel({ onClose, onPlaying }: { onClose: () => void; onPlaying: () => void }) {
  const v = useVoice();
  const channelId = v.channelId;
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function enqueue() {
    if (!channelId || !url.trim()) return;
    if (!parseYouTube(url)) return setError("Isso não parece um link do YouTube.");
    setBusy(true);
    setError(null);
    try {
      setQueue(channelId, await api<QueueItem[]>(`/channels/${channelId}/queue`, { json: { url } }));
      setUrl("");
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  const can = v.yt.canControl;

  function playNow() {
    if (!can) return setError("Tem música de outra pessoa tocando: ponha na fila.");
    if (!v.yt.load(url)) return setError("Isso não parece um link do YouTube.");
    setUrl("");
    onPlaying();
    onClose();
  }

  return (
    <div className="pop-in w-[min(440px,calc(100vw-24px))] rounded-[16px] border border-oat/[0.08] bg-cocoa-2 p-3">
      <div className="flex items-center justify-between px-1">
        <p className="font-display text-[18px]">YouTube junto</p>
        <button type="button" onClick={onClose} aria-label="Fechar" className="press grid size-7 place-items-center rounded-md text-oat/50 hover:bg-cocoa-4 hover:text-oat">
          <X className="size-4" />
        </button>
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (v.yt.state || !can) void enqueue();
          else playNow();
        }}
        className="mt-2.5"
      >
        <input
          autoFocus
          className="field h-11 !bg-cocoa-0"
          placeholder="Cole o link do vídeo"
          value={url}
          onChange={(e) => (setUrl(e.target.value), setError(null))}
          aria-label="Link do YouTube"
        />
        {error && <p className="mt-1.5 px-1 text-[12.5px] text-[#ff8f92]">{error}</p>}
        <div className="mt-2 flex gap-2">
          <button type="button" onClick={playNow} disabled={!url.trim() || !can} className="btn-ember flex h-10 flex-1 items-center justify-center gap-1.5 text-[14px]">
            <Play className="size-4" /> Tocar agora
          </button>
          <button type="button" onClick={() => void enqueue()} disabled={!url.trim() || busy} className="btn-quiet flex h-10 flex-1 items-center justify-center gap-1.5 text-[14px]">
            <ListPlus className="size-4" /> {busy ? "Pondo…" : "Pôr na fila"}
          </button>
        </div>
      </form>

      <div className="mt-4 flex items-baseline justify-between px-1">
        <p className="label text-oat/45">Fila · {v.queue.length}</p>
        {v.queue.length > 0 && <p className="text-[11.5px] text-oat/35">o mais votado toca quando o vídeo acabar</p>}
      </div>
      {v.queue.length === 0 ? (
        <p className="mt-2 px-1 pb-1 text-[13.5px] leading-relaxed text-oat/45">
          Vazia. Põe uns vídeos aqui e eles vão tocando sozinhos, um atrás do outro. Quem quiser, vota para subir.
        </p>
      ) : (
        <ul className="mt-1.5 max-h-[300px] space-y-1 overflow-y-auto">
          {v.queue.map((item, i) => (
            <QueueRow
              key={item.id}
              item={item}
              first={i === 0}
              channelId={channelId!}
              dj={v.isDj}
              onPlay={can ? () => (void v.playQueued(item), onPlaying()) : undefined}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function QueueRow({ item, first, channelId, dj, onPlay }: { item: QueueItem; first: boolean; channelId: string; dj: boolean; onPlay?: () => void }) {
  const me = useStore((s) => s.me);
  const mine = !!me && item.added_by === me.id;
  // sem dono = o rádio da call escolheu (qualquer um da call pode tirar)
  const radio = !item.added_by;
  const who = useUser(item.added_by ?? undefined);
  const voted = !!me && item.voters.includes(me.id);

  async function call(path: string, method: string) {
    try {
      setQueue(channelId, await api<QueueItem[]>(path, { method }));
    } catch (e) {
      toast(errorText(e));
    }
  }

  return (
    <li className={`group flex items-center gap-2.5 rounded-[11px] p-1.5 ${first ? "bg-ember/[0.08]" : "hover:bg-cocoa-3"}`}>
      <button type="button" onClick={onPlay} disabled={!onPlay} className="relative shrink-0 overflow-hidden rounded-[8px] disabled:cursor-default" aria-label={`Tocar ${item.title} agora`}>
        <img src={`https://i.ytimg.com/vi/${item.video_id}/mqdefault.jpg`} alt="" className="h-[45px] w-[80px] object-cover" loading="lazy" />
        <span className={`absolute inset-0 grid place-items-center bg-cocoa-0/60 opacity-0 transition-opacity ${onPlay ? "group-hover:opacity-100" : ""}`}>
          <Play className="size-5 fill-oat text-oat" />
        </span>
      </button>
      <div className="min-w-0 flex-1">
        <p className="line-clamp-2 text-[13px] font-semibold leading-snug">{item.title}</p>
        <p className="truncate text-[11.5px] text-oat/40">
          {first && <span className="font-semibold text-ember-2">a seguir · </span>}
          {item.author ? `${item.author} · ` : ""}
          {who ? `pôs ${who.display_name}` : radio ? "📻 rádio da call" : ""}
        </p>
      </div>
      <button
        type="button"
        onClick={() => void call(`/queue/${item.id}/vote`, voted ? "DELETE" : "PUT")}
        aria-pressed={voted}
        aria-label={voted ? "Tirar voto" : "Votar para subir"}
        className={`press flex h-9 w-10 shrink-0 flex-col items-center justify-center rounded-[9px] text-[11px] font-bold tabular-nums leading-none ${
          voted ? "bg-ember text-white" : "bg-cocoa-0 text-oat/60 hover:text-oat"
        }`}
      >
        <ChevronUp className="size-4" />
        {item.voters.length}
      </button>
      {(mine || dj || radio) && (
      <button
        type="button"
        onClick={() => void call(`/queue/${item.id}`, "DELETE")}
        aria-label="Tirar da fila"
        className="press grid size-7 shrink-0 place-items-center rounded-md text-oat/35 opacity-0 hover:bg-cocoa-4 hover:text-oat focus-visible:opacity-100 group-hover:opacity-100"
      >
        <X className="size-4" />
      </button>
      )}
    </li>
  );
}
