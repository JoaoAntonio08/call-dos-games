"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Megaphone, Volume2, X } from "lucide-react";
import { api, errorText } from "@/lib/api";
import { useStore } from "@/lib/store";
import { toast } from "@/lib/ui";
import { chime, useVoice } from "@/lib/voice";
import type { User } from "@/lib/types";
import { Avatar } from "./bits";

interface Hype {
  server_id: string;
  server_name: string;
  channel_id: string;
  channel_name: string;
  in_call: number;
  by: User;
}

/** Botão de hype: avisa todo mundo do servidor para entrar na call. */
export async function sendHype(channelId: string) {
  try {
    const r = await api<{ notified: number }>(`/channels/${channelId}/hype`, { method: "POST" });
    toast(r.notified ? `📣 Chamado! ${r.notified === 1 ? "1 pessoa avisada" : `${r.notified} pessoas avisadas`}.` : "📣 Chamado! (ainda não tem mais ninguém no servidor)");
    askNotifications();
  } catch (e) {
    toast(errorText(e));
  }
}

/** Pede para avisar com o app minimizado (só pergunta uma vez, e só depois de um clique). */
export function askNotifications() {
  try {
    if ("Notification" in window && Notification.permission === "default") void Notification.requestPermission();
  } catch {
    /* sem notificações */
  }
}

export function HypeButton({ channelId, compact }: { channelId: string; compact?: boolean }) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        await sendHype(channelId);
        setBusy(false);
      }}
      title="Hype: chama todo mundo do servidor para a call"
      aria-label="Chamar a turma para a call (hype)"
      className={
        compact
          ? "press flex h-8 items-center gap-1.5 rounded-[9px] px-2.5 text-[13px] font-semibold text-honey hover:bg-cocoa-4"
          : "btn-ember inline-flex h-10 items-center gap-2 px-5 text-[14.5px]"
      }
    >
      <Megaphone className="size-4" />
      <span className={compact ? "hidden sm:inline" : ""}>{compact ? "Hype" : "Chamar a turma"}</span>
    </button>
  );
}

/** O aviso que aparece para quem foi chamado. */
export function HypeAlert() {
  const [hype, setHype] = useState<Hype | null>(null);
  const v = useVoice();
  const router = useRouter();
  const joinVolume = v.prefs.joinVolume;
  const inChannel = v.channelId;

  useEffect(() => {
    const on = (e: Event) => {
      const d = (e as CustomEvent).detail as Hype;
      if (inChannel === d.channel_id) return; // já está lá
      setHype(d);
      chime("self", joinVolume);
      window.setTimeout(() => chime("ping", joinVolume), 450);
      try {
        if (document.hidden && "Notification" in window && Notification.permission === "granted") {
          const n = new Notification(`📣 ${d.by.display_name} está chamando a turma`, {
            body: `Entra na call ${d.channel_name} em ${d.server_name}!`,
            tag: `hype-${d.server_id}`,
          });
          n.onclick = () => {
            window.focus();
            router.push(`/app/s/${d.server_id}/${d.channel_id}`);
            n.close();
          };
        }
      } catch {
        /* sem notificações */
      }
    };
    window.addEventListener("cdg:hype", on);
    return () => window.removeEventListener("cdg:hype", on);
  }, [inChannel, joinVolume, router]);

  // some sozinho depois de meio minuto
  useEffect(() => {
    if (!hype) return;
    const t = window.setTimeout(() => setHype(null), 30_000);
    return () => window.clearTimeout(t);
  }, [hype]);

  if (!hype) return null;
  const u = hype.by;
  return (
    <div role="alert" className="slide-in fixed right-4 top-4 z-[65] w-[min(360px,calc(100vw-32px))] overflow-hidden rounded-[18px] bg-cocoa-0 shadow-[0_18px_50px_rgb(0_0_0/0.5)]">
      <div className="h-1.5 bg-gradient-to-r from-ember via-honey to-rust" />
      <div className="flex gap-3 p-4">
        <Avatar name={u.display_name} avatar={u.avatar} accent={u.accent} size={44} />
        <div className="min-w-0 flex-1">
          <p className="label text-honey">📣 Hype em {hype.server_name}</p>
          <p className="mt-1 text-[14.5px] leading-snug">
            <b>{u.display_name}</b> está chamando a turma para a call <b>🔊 {hype.channel_name}</b>
            {hype.in_call > 1 ? ` (já tem ${hype.in_call} lá)` : ""}!
          </p>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              className="btn-ember inline-flex h-9 items-center gap-1.5 px-4 text-[13.5px]"
              onClick={() => {
                router.push(`/app/s/${hype.server_id}/${hype.channel_id}`);
                void v.join(hype.channel_id);
                setHype(null);
                askNotifications();
              }}
            >
              <Volume2 className="size-4" /> Entrar na call
            </button>
            <button
              type="button"
              className="h-9 rounded-[10px] px-3 text-[13.5px] font-semibold text-oat/60 hover:bg-cocoa-3 hover:text-oat"
              onClick={() => {
                setHype(null);
                askNotifications();
              }}
            >
              Agora não
            </button>
          </div>
        </div>
        <button type="button" onClick={() => setHype(null)} className="self-start rounded-md p-1 text-oat/40 hover:text-oat" aria-label="Fechar aviso">
          <X className="size-4" />
        </button>
      </div>
    </div>
  );
}

/** Linha do chat que registra o hype (para quem estava fora ver depois). */
export function HypeLine({ channelId, name, stamp, serverId }: { channelId: string; name: string; stamp: string; serverId?: string }) {
  const channel = useStore((s) => (serverId ? s.servers[serverId]?.channels.find((c) => c.id === channelId) : undefined));
  const router = useRouter();
  const v = useVoice();
  return (
    <div className="group flex items-center gap-3 px-4 py-1.5 text-[14px] text-oat/60 hover:bg-cocoa-2/40">
      <span className="w-10 text-center text-[16px]" aria-hidden>
        📣
      </span>
      <span className="min-w-0">
        <b className="text-oat">{name}</b> chamou a turma para a call{" "}
        {channel ? (
          <button
            type="button"
            onClick={() => {
              router.push(`/app/s/${serverId}/${channel.id}`);
              void v.join(channel.id);
            }}
            className="font-semibold text-ember-2 hover:underline"
          >
            🔊 {channel.name}
          </button>
        ) : (
          "de voz"
        )}
        <span className="ml-2 text-[11.5px] text-oat/30">{stamp}</span>
      </span>
    </div>
  );
}
