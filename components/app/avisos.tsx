"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { create } from "zustand";
import { markRead, useStore } from "@/lib/store";
import { toast, useRoute } from "@/lib/ui";
import { chime, useVoice } from "@/lib/voice";
import type { Message } from "@/lib/types";
import { Toggle } from "./bits";

/* ------------------------------------------------------------------ */
/* Avisos de mensagem (DM e @menção), silenciar e marcar como lida      */
/* ------------------------------------------------------------------ */

interface Silence {
  /** avisar mensagens diretas e @menções (som + notificação do Windows) */
  enabled: boolean;
  servers: string[];
  channels: string[];
}
const KEY = "cdg:avisos";
function load(): Silence {
  try {
    return { enabled: true, servers: [], channels: [], ...JSON.parse(localStorage.getItem(KEY) || "{}") };
  } catch {
    return { enabled: true, servers: [], channels: [] };
  }
}
export const useSilence = create<Silence>(() => (typeof window === "undefined" ? { enabled: true, servers: [], channels: [] } : load()));
function save(next: Partial<Silence>) {
  useSilence.setState(next);
  try {
    const { enabled, servers, channels } = useSilence.getState();
    localStorage.setItem(KEY, JSON.stringify({ enabled, servers, channels }));
  } catch {
    /* sem armazenamento: vale só nesta aba */
  }
}

export const isMuted = (s: Silence, serverId: string | null | undefined, channelId: string) =>
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
export async function setNotifications(enabled: boolean) {
  if (enabled && "Notification" in window && Notification.permission === "default") {
    try {
      await Notification.requestPermission();
    } catch {
      /* navegador sem suporte */
    }
  }
  save({ enabled });
}

/** Marca como lido tudo de um servidor (ou um canal). */
export function markServerRead(serverId: string) {
  const sv = useStore.getState().servers[serverId];
  if (!sv) return;
  for (const c of sv.channels) if (c.type === "text") markRead(c.id, c.last_message_id);
}

const mentionRe = (username: string) => new RegExp(`(^|[^\\w@])@(${username.replace(/\./g, "\\.")}|todos|everyone)(?![\\w.])`, "i");

/** Fica ouvindo as mensagens novas e avisa (som + notificação) o que for para você. */
export function MessageAlerts() {
  const router = useRouter();
  const route = useRoute();
  const v = useVoice();
  const routeRef = useRef(route);
  const volRef = useRef(v.prefs.joinVolume);
  useEffect(() => {
    routeRef.current = route;
    volRef.current = v.prefs.joinVolume;
  });

  useEffect(() => {
    const on = (e: Event) => {
      const m = (e as CustomEvent<Message>).detail;
      const st = useStore.getState();
      const me = st.me;
      const sil = useSilence.getState();
      if (!me || !m.author || m.author.id === me.id || !sil.enabled || m.ephemeral) return;
      const dm = st.dms.find((d) => d.id === m.channel_id);
      const server = dm ? undefined : Object.values(st.servers).find((s) => s.channels.some((c) => c.id === m.channel_id));
      if (isMuted(sil, server?.id, m.channel_id)) return;
      const mention = mentionRe(me.username).test(m.content);
      if (!dm && !mention) return;
      const r = routeRef.current;
      const looking = document.hasFocus() && !document.hidden && ((r.kind === "dm" && r.id === m.channel_id) || (r.kind === "server" && r.channelId === m.channel_id));
      if (looking) return;
      chime("ping", volRef.current);
      const where = dm ? "Mensagem direta" : `#${server?.channels.find((c) => c.id === m.channel_id)?.name ?? "canal"} · ${server?.name ?? ""}`;
      const path = dm ? `/app/dm/${m.channel_id}` : `/app/s/${server?.id}/${m.channel_id}`;
      const body = (m.content || (m.attachments?.length ? "📎 Anexo" : "")).slice(0, 180);
      try {
        if ((document.hidden || !document.hasFocus()) && "Notification" in window && Notification.permission === "granted") {
          const n = new Notification(`${m.author.display_name} (${where})`, { body, tag: `msg-${m.channel_id}`, silent: true });
          n.onclick = () => {
            window.focus();
            router.push(path);
            n.close();
          };
        } else {
          toast(`💬 ${m.author.display_name}: ${body.slice(0, 80)}`);
        }
      } catch {
        /* sem notificações */
      }
    };
    window.addEventListener("cdg:message", on);
    return () => window.removeEventListener("cdg:message", on);
  }, [router]);
  return null;
}

/** Aba "Notificações" das configurações. */
export function NotificationsTab() {
  const sil = useSilence();
  const servers = useStore((s) => s.servers);
  const perm = typeof window !== "undefined" && "Notification" in window ? Notification.permission : "denied";
  const mutedServers = sil.servers.filter((id) => servers[id]);
  const mutedChannels = sil.channels
    .map((id) => {
      const sv = Object.values(servers).find((s) => s.channels.some((c) => c.id === id));
      const ch = sv?.channels.find((c) => c.id === id);
      return sv && ch ? { id, label: `#${ch.name} · ${sv.name}` } : null;
    })
    .filter((x): x is { id: string; label: string } => !!x);
  return (
    <div className="max-w-xl">
      <h2 className="mb-6 pr-10 font-display text-[30px] leading-tight">Notificações</h2>
      <section className="mb-7">
        <label className="flex items-center justify-between gap-4 py-1">
          <span>
            <span className="block text-[14.5px] font-medium">Avisar mensagens diretas e @menções</span>
            <span className="block text-[12.5px] text-oat/45">
              Um som e, com o app em segundo plano, uma notificação do Windows. Quem escreve @seunome ou @todos te chama.
            </span>
          </span>
          <Toggle checked={sil.enabled} onChange={(v) => void setNotifications(v)} label="Avisar mensagens diretas e menções" />
        </label>
        {sil.enabled && perm === "denied" && (
          <p className="mt-2 rounded-[10px] bg-honey/15 px-3 py-2 text-[12.5px] text-honey">
            O navegador bloqueou as notificações deste site. Você ainda ouve o som; para ver o aviso fora da aba, libere as notificações no cadeado da barra de endereço.
          </p>
        )}
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
