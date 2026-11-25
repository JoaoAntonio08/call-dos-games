"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Mic, Play, Square, Trash2, X } from "lucide-react";
import { api, API_URL, errorText, getToken } from "@/lib/api";
import { toast } from "@/lib/ui";
import type { User } from "@/lib/types";
import { Avatar } from "./bits";

/* ------------------------------------------------------------------ */
/* Recado na call vazia: entrou e não tem ninguém? Grave um áudio de    */
/* até 30 s. Quem entrar depois ouve. Some sozinho em 7 dias.           */
/* ------------------------------------------------------------------ */

export interface Recado {
  id: string;
  author: User | null;
  url: string;
  seconds: number;
  created_at: string;
  heard: boolean;
  mine: boolean;
}

const MAX_S = 30;

function useRecados(channelId: string) {
  const [list, setList] = useState<Recado[]>([]);
  const load = useCallback(() => {
    api<Recado[]>(`/channels/${channelId}/recados`)
      .then(setList)
      .catch(() => setList([]));
  }, [channelId]);
  useEffect(() => {
    load();
    const on = (e: Event) => {
      if ((e as CustomEvent<{ channel_id: string }>).detail?.channel_id === channelId) load();
    };
    window.addEventListener("cdg:recados", on);
    return () => window.removeEventListener("cdg:recados", on);
  }, [channelId, load]);
  return { list, load, setList };
}

/** Toca o áudio do recado (baixado com o login, como os anexos). */
async function playRecado(url: string): Promise<HTMLAudioElement | null> {
  try {
    const token = getToken();
    const full = url.startsWith("http") ? url : API_URL + url;
    if (!full.startsWith(API_URL + "/files/")) return null;
    const r = await fetch(full, { headers: token ? { Authorization: `Bearer ${token}` } : {}, credentials: "include" });
    if (!r.ok) return null;
    const src = URL.createObjectURL(await r.blob());
    const a = new Audio(src);
    a.onended = () => URL.revokeObjectURL(src);
    await a.play();
    return a;
  } catch {
    return null;
  }
}

/** Botão de gravar, quando você está sozinho na call. */
export function RecadoRecorder({ channelId, mic }: { channelId: string; mic?: MediaStreamTrack }) {
  const [rec, setRec] = useState<{ started: number } | null>(null);
  const [left, setLeft] = useState(MAX_S);
  const recorder = useRef<MediaRecorder | null>(null);
  const copy = useRef<MediaStreamTrack | null>(null);
  const { list } = useRecados(channelId);
  const mine = list.filter((r) => r.mine).length;

  useEffect(() => {
    if (!rec) return;
    const t = window.setInterval(() => {
      const s = MAX_S - Math.floor((Date.now() - rec.started) / 1000);
      setLeft(s);
      if (s <= 0) recorder.current?.stop();
    }, 250);
    return () => window.clearInterval(t);
  }, [rec]);

  useEffect(
    () => () => {
      if (recorder.current?.state === "recording") recorder.current.stop();
      copy.current?.stop();
    },
    [],
  );

  const start = () => {
    if (!mic || mic.readyState !== "live" || typeof MediaRecorder === "undefined") return toast("Ligue o microfone para gravar o recado.");
    const type = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"].find((m) => MediaRecorder.isTypeSupported(m));
    if (!type) return toast("Este navegador não grava áudio.");
    const track = mic.clone();
    track.enabled = true;
    copy.current = track;
    const r = new MediaRecorder(new MediaStream([track]), { mimeType: type, audioBitsPerSecond: 48_000 });
    const chunks: Blob[] = [];
    const began = Date.now();
    r.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    r.onstop = async () => {
      track.stop();
      setRec(null);
      const seconds = Math.min(MAX_S, Math.max(1, Math.round((Date.now() - began) / 1000)));
      if (seconds < 2) return toast("Recado curtinho demais.");
      const blob = new Blob(chunks, { type: type.split(";")[0] });
      const form = new FormData();
      form.append("file", new File([blob], type.startsWith("audio/mp4") ? "recado.m4a" : "recado.webm", { type: blob.type }));
      form.append("seconds", String(seconds));
      try {
        await api(`/channels/${channelId}/recados`, { form });
        toast("Recado deixado! Quem entrar na call vai ouvir.");
      } catch (e) {
        toast(errorText(e));
      }
    };
    recorder.current = r;
    r.start(1000);
    setLeft(MAX_S);
    setRec({ started: began });
  };

  return rec ? (
    <button type="button" onClick={() => recorder.current?.stop()} className="press flex items-center gap-1.5 rounded-full bg-rust px-3 py-1 text-[13px] font-semibold text-white">
      <Square className="size-3.5" /> Parar ({left}s)
    </button>
  ) : (
    <button
      type="button"
      onClick={start}
      disabled={mine >= 3}
      title={mine >= 3 ? "Você já deixou 3 recados aqui" : "Grave um áudio de até 30 s: quem entrar depois ouve"}
      className="flex items-center gap-1 text-[13px] font-semibold text-ember-2 hover:underline disabled:opacity-40"
    >
      <Mic className="size-3.5" /> Deixar um recado de voz
    </button>
  );
}

/** Recados que ficaram para você nesta call. */
export function RecadosInbox({ channelId }: { channelId: string }) {
  const { list, setList } = useRecados(channelId);
  const [open, setOpen] = useState(true);
  const playing = useRef<HTMLAudioElement | null>(null);
  const fresh = list.filter((r) => !r.heard);
  useEffect(() => () => playing.current?.pause(), []);
  if (!list.length || !open) return null;
  const play = async (r: Recado) => {
    playing.current?.pause();
    playing.current = await playRecado(r.url);
    if (!playing.current) return toast("Não deu para tocar o recado.");
    if (!r.heard) {
      setList((cur) => cur.map((x) => (x.id === r.id ? { ...x, heard: true } : x)));
      void api(`/recados/${r.id}/ouvido`, { method: "POST" }).catch(() => {});
    }
  };
  const remove = async (r: Recado) => {
    try {
      await api(`/recados/${r.id}`, { method: "DELETE" });
      setList((cur) => cur.filter((x) => x.id !== r.id));
    } catch (e) {
      toast(errorText(e));
    }
  };
  return (
    <div className="pop-in w-full max-w-md rounded-[16px] bg-cocoa-0 p-3">
      <div className="mb-2 flex items-center justify-between">
        <p className="label text-ember">📼 Recados nesta call{fresh.length ? ` · ${fresh.length} novo${fresh.length > 1 ? "s" : ""}` : ""}</p>
        <button type="button" onClick={() => setOpen(false)} className="press grid size-7 place-items-center rounded-full hover:bg-cocoa-3" aria-label="Fechar recados">
          <X className="size-4" />
        </button>
      </div>
      <ul className="space-y-1">
        {list.map((r) => (
          <li key={r.id} className="flex items-center gap-2 rounded-[12px] bg-cocoa-3 px-2 py-1.5">
            <Avatar name={r.author?.display_name ?? "?"} avatar={r.author?.avatar ?? null} size={28} />
            <span className="min-w-0 flex-1 truncate text-[13.5px]">
              <b>{r.author?.display_name ?? "Alguém"}</b>
              <span className="text-oat/50"> · {r.seconds}s · {new Date(r.created_at).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</span>
            </span>
            {!r.heard && <span className="size-2 shrink-0 rounded-full bg-ember" aria-label="novo" />}
            <button type="button" onClick={() => void play(r)} className="press grid size-8 place-items-center rounded-full bg-ember text-white" aria-label="Ouvir recado">
              <Play className="size-4" />
            </button>
            {r.mine && (
              <button type="button" onClick={() => void remove(r)} className="press grid size-8 place-items-center rounded-full text-oat/50 hover:bg-cocoa-4 hover:text-oat" aria-label="Apagar recado">
                <Trash2 className="size-4" />
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
