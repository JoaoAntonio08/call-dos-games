"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { BellOff, ChevronDown, Hash, HeadphoneOff, LogOut, MicOff, Music2, PartyPopper, Pause, Plus, Settings, Trophy, TvMinimalPlay, UserPlus, Users, Video, Volume2 } from "lucide-react";
import { api, errorText } from "@/lib/api";
import { isUnread, markRead, useStore, useUser, usePresence } from "@/lib/store";
import { openModal, openProfile, openUserMenu, toast, type ServerPage } from "@/lib/ui";
import { useVoice } from "@/lib/voice";
import type { Channel, Dm, NowPlaying, Server, VoiceMember } from "@/lib/types";
import { AnimImg, Avatar, Popover, useAnchor } from "./bits";
import { canModerate, dragProps, moveToChannel, useDropTarget } from "./user-menu";
import { isMuted, toggleChannelMute, useSilence } from "./avisos";
import { openContextMenu } from "./context-menu";

/* ------------------------------------------------------------------ */
/* início: amigos e conversas diretas                                  */
/* ------------------------------------------------------------------ */

export function HomeSidebar({ activeDm }: { activeDm: string | null }) {
  const dms = useStore((s) => s.dms);
  const reads = useStore((s) => s.reads);
  const pending = useStore((s) => s.friends.filter((f) => f.relation === "incoming").length);
  const [q, setQ] = useState("");
  const shown = q ? dms.filter((d) => d.recipients.some((u) => (u.display_name + u.username).toLowerCase().includes(q.toLowerCase()))) : dms;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="px-3 pb-2 pt-3">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Procurar conversa" className="field h-9 !rounded-[10px] !py-0 text-[13.5px]" />
      </div>
      <div className="px-2">
        <Link
          href="/app"
          className={`flex h-10 items-center gap-3 rounded-[10px] px-2.5 text-[14.5px] font-semibold ${!activeDm ? "bg-cocoa-4 text-oat" : "text-oat/60 hover:bg-cocoa-3 hover:text-oat"}`}
        >
          <Users className="size-[18px]" /> Amigos
          {pending > 0 && <span className="ml-auto rounded-full bg-rust px-1.5 text-[11px] font-bold">{pending}</span>}
        </Link>
      </div>
      <p className="label mt-5 px-4 text-oat/40">Conversas</p>
      <div className="mt-2 min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2 pb-3">
        {shown.length === 0 && (
          <p className="px-2.5 py-3 text-[13px] leading-relaxed text-oat/40">
            {q ? "Ninguém com esse nome." : "Nenhuma conversa ainda. Abra o perfil de alguém e mande um oi."}
          </p>
        )}
        {shown.map((d) => (
          <DmRow key={d.id} dm={d} active={d.id === activeDm} unread={d.id !== activeDm && isUnread(d.id, d.last_message_id, reads)} />
        ))}
      </div>
    </div>
  );
}

function DmRow({ dm, active, unread }: { dm: Dm; active: boolean; unread: boolean }) {
  const other = dm.recipients[0];
  const user = useUser(other?.id) ?? other;
  const status = usePresence(other?.id);
  const voiceHere = useStore((s) => (s.voice[dm.id]?.length ?? 0) > 0);
  if (!user) return null;
  return (
    <Link
      href={`/app/dm/${dm.id}`}
      className={`group flex h-11 items-center gap-3 rounded-[10px] px-2 ${active ? "bg-cocoa-4 text-oat" : unread ? "text-oat hover:bg-cocoa-3" : "text-oat/60 hover:bg-cocoa-3 hover:text-oat"}`}
      style={{ ["--dot-ring" as string]: active ? "var(--color-cocoa-4)" : "var(--color-cocoa-2)" }}
    >
      <Avatar name={user.display_name} avatar={user.avatar} accent={user.accent} size={32} status={status} />
      <span className="min-w-0 flex-1">
        <span className={`block truncate text-[14.5px] ${unread ? "font-bold" : "font-medium"}`}>{user.display_name}</span>
        {user.custom_status && <span className="block truncate text-[12px] text-oat/45">{user.custom_status}</span>}
      </span>
      {voiceHere && <Volume2 className="size-4 text-moss" aria-label="Em call" />}
      {unread && <span className="size-2 rounded-full bg-oat" />}
    </Link>
  );
}

/* ------------------------------------------------------------------ */
/* servidor                                                            */
/* ------------------------------------------------------------------ */

export function ServerSidebar({ server, activeId, page }: { server: Server; activeId: string | null; page?: ServerPage }) {
  const me = useStore((s) => s.me);
  const reads = useStore((s) => s.reads);
  const menu = useAnchor<HTMLButtonElement>();
  const router = useRouter();
  const myRole = server.members.find((m) => m.user.id === me?.id)?.role ?? "member";
  const admin = myRole !== "member";
  const text = server.channels.filter((c) => c.type === "text");
  const voice = server.channels.filter((c) => c.type === "voice");

  async function leaveServer() {
    if (!confirm(`Sair de ${server.name}? Você só volta com um convite novo.`)) return;
    try {
      await api(`/servers/${server.id}/members/${me!.id}`, { method: "DELETE" });
      router.replace("/app");
    } catch (e) {
      toast(errorText(e));
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* capa do servidor */}
      <button
        type="button"
        onClick={(e) => menu.open(e.currentTarget)}
        className={`group relative w-full shrink-0 overflow-hidden text-left ${server.banner ? "h-[118px]" : "h-12"}`}
      >
        {server.banner && (
          <>
            <AnimImg media={server.banner} alt="" className="absolute inset-0 size-full object-cover" />
            <span className="absolute inset-0 bg-gradient-to-b from-cocoa-0/10 via-transparent to-cocoa-2" />
          </>
        )}
        <span className={`absolute inset-x-0 bottom-0 flex h-12 items-center gap-2 px-4 ${server.banner ? "" : "border-b border-cocoa-0/60 group-hover:bg-cocoa-3"}`}>
          <span className="min-w-0 flex-1 truncate font-display text-[19px] font-semibold text-oat drop-shadow-sm">{server.name}</span>
          <ChevronDown className="size-4 text-oat/70" />
        </span>
      </button>

      <Popover anchor={menu.rect} onClose={menu.close} side="bottom" className="w-[220px]">
        <div className="rounded-[14px] bg-cocoa-0 p-1.5 text-[14px]" onClick={menu.close}>
          <MenuItem icon={<UserPlus />} onClick={() => openModal({ kind: "invite", serverId: server.id })} accent>
            Convidar a turma
          </MenuItem>
          <MenuItem icon={<Settings />} onClick={() => openModal({ kind: "server-settings", serverId: server.id })}>
            {admin ? "Configurações do servidor" : "Soundboard e emojis"}
          </MenuItem>
          {admin && (
            <>
              <MenuItem icon={<Hash />} onClick={() => openModal({ kind: "create-channel", serverId: server.id, type: "text" })}>
                Criar canal de texto
              </MenuItem>
              <MenuItem icon={<Volume2 />} onClick={() => openModal({ kind: "create-channel", serverId: server.id, type: "voice" })}>
                Criar canal de voz
              </MenuItem>
            </>
          )}
          {myRole !== "owner" && (
            <MenuItem icon={<LogOut />} onClick={leaveServer} danger>
              Sair do servidor
            </MenuItem>
          )}
        </div>
      </Popover>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
        <div className="mt-3 space-y-px">
          <PageRow href={`/app/s/${server.id}/hall`} active={page === "hall"} icon={<Trophy />} label="Hall da Fama" />
          <PageRow href={`/app/s/${server.id}/lista`} active={page === "lista"} icon={<TvMinimalPlay />} label="Onde paramos" />
          <PageRow href={`/app/s/${server.id}/noites`} active={page === "noites"} icon={<PartyPopper />} label="Noite da turma" />
        </div>
        <Group title="Texto" onAdd={admin ? () => openModal({ kind: "create-channel", serverId: server.id, type: "text" }) : undefined}>
          {text.map((c) => (
            <TextRow key={c.id} server={server} channel={c} active={c.id === activeId} unread={c.id !== activeId && isUnread(c.id, c.last_message_id, reads)} />
          ))}
        </Group>
        <Group title="Voz" onAdd={admin ? () => openModal({ kind: "create-channel", serverId: server.id, type: "voice" }) : undefined}>
          {voice.map((c) => (
            <VoiceRow key={c.id} server={server} channel={c} active={c.id === activeId} />
          ))}
        </Group>
      </div>
    </div>
  );
}

function MenuItem({ icon, children, onClick, danger, accent }: { icon: React.ReactNode; children: React.ReactNode; onClick: () => void; danger?: boolean; accent?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-2.5 rounded-[9px] px-2.5 py-2 text-left font-medium [&_svg]:size-4 ${
        danger ? "text-[#ff8f92] hover:bg-rust hover:text-oat" : accent ? "text-ember-2 hover:bg-ember hover:text-white" : "text-oat/80 hover:bg-cocoa-4 hover:text-oat"
      }`}
    >
      {icon}
      {children}
    </button>
  );
}

function PageRow({ href, active, icon, label }: { href: string; active: boolean; icon: React.ReactNode; label: string }) {
  return (
    <Link
      href={href}
      className={`flex h-9 items-center gap-2 rounded-[9px] px-2 text-[15px] [&_svg]:size-[18px] ${
        active ? "bg-cocoa-4 font-semibold text-oat [&_svg]:text-ember-2" : "text-oat/55 hover:bg-cocoa-3 hover:text-oat/90 [&_svg]:text-oat/40"
      }`}
    >
      {icon}
      {label}
    </Link>
  );
}

function Group({ title, onAdd, children }: { title: string; onAdd?: () => void; children: React.ReactNode }) {
  return (
    <div className="mt-4">
      <div className="flex items-center px-2 pb-1">
        <span className="label flex-1 text-oat/40">{title}</span>
        {onAdd && (
          <button type="button" onClick={onAdd} aria-label={`Criar canal de ${title.toLowerCase()}`} className="press grid size-6 place-items-center rounded-md text-oat/40 hover:bg-cocoa-4 hover:text-oat">
            <Plus className="size-3.5" />
          </button>
        )}
      </div>
      <div className="space-y-px">{children}</div>
    </div>
  );
}

function TextRow({ server, channel, active, unread: rawUnread }: { server: Server; channel: Channel; active: boolean; unread: boolean }) {
  const muted = useSilence((s) => isMuted(s, server.id, channel.id));
  const unread = rawUnread && !muted;
  return (
    <Link
      href={`/app/s/${server.id}/${channel.id}`}
      onContextMenu={(e) =>
        openContextMenu(
          e,
          [
            { label: "Marcar como lida", onClick: () => markRead(channel.id, channel.last_message_id) },
            { label: useSilence.getState().channels.includes(channel.id) ? "Tirar o silêncio do canal" : "Silenciar canal", onClick: () => toggleChannelMute(channel.id) },
            { label: "Copiar link", onClick: () => void navigator.clipboard?.writeText(`${location.origin}/app/s/${server.id}/${channel.id}`).then(() => toast("Link copiado.")), sep: true },
          ],
          `#${channel.name}`,
        )
      }
      className={`relative flex h-9 items-center gap-2 rounded-[9px] px-2 text-[15px] ${
        active ? "bg-cocoa-4 font-semibold text-oat" : unread ? "font-bold text-oat hover:bg-cocoa-3" : muted ? "text-oat/30 hover:bg-cocoa-3 hover:text-oat/60" : "text-oat/55 hover:bg-cocoa-3 hover:text-oat/90"
      }`}
    >
      {unread && <span className="absolute -left-2 top-1/2 h-2 w-1 -translate-y-1/2 rounded-r-full bg-oat" />}
      <Hash className="size-[17px] shrink-0 opacity-50" />
      <span className="truncate">{channel.name}</span>
      {muted && <BellOff className="ml-auto size-3.5 shrink-0 opacity-60" aria-label="Silenciado" />}
    </Link>
  );
}

function VoiceRow({ server, channel, active }: { server: Server; channel: Channel; active: boolean }) {
  const members = useStore((s) => s.voice[channel.id]) ?? [];
  const music = useStore((s) => s.music[channel.id]);
  const me = useStore((s) => s.me);
  const v = useVoice();
  const here = v.channelId === channel.id;
  // solte alguém (arrastado da call) aqui para levar para esta sala
  const drop = useDropTarget((userId) => void moveToChannel(server, userId, channel.id, me?.id, v.join));
  return (
    <div {...drop.props} className={`rounded-[10px] ${drop.over ? "bg-ember/20 outline-2 outline-dashed outline-ember" : ""}`}>
      <Link
        href={`/app/s/${server.id}/${channel.id}`}
        onDoubleClick={() => void v.join(channel.id)}
        className={`flex h-9 items-center gap-2 rounded-[9px] px-2 text-[15px] ${
          active ? "bg-cocoa-4 font-semibold text-oat" : here ? "text-oat" : "text-oat/55 hover:bg-cocoa-3 hover:text-oat/90"
        }`}
        title="Clique para ver, clique duas vezes para entrar"
      >
        <Volume2 className={`size-[17px] shrink-0 ${here ? "text-moss" : "opacity-50"}`} />
        <span className="truncate">{channel.name}</span>
        {channel.user_limit ? (
          <span
            className={`ml-auto rounded-[5px] bg-cocoa-0 px-1 text-[11px] tabular-nums ${members.length >= channel.user_limit ? "text-rust" : "text-oat/45"}`}
            title={`Até ${channel.user_limit} pessoas`}
          >
            {String(members.length).padStart(2, "0")}/{String(channel.user_limit).padStart(2, "0")}
          </span>
        ) : (
          members.length > 0 && <span className="ml-auto text-[11.5px] tabular-nums text-oat/40">{members.length}</span>
        )}
      </Link>
      {(members.length > 0 || music) && (
        <ul className="mb-1 ml-7 mt-0.5 space-y-px">
          {members.map((m) => (
            <VoiceMemberRow key={m.user_id} m={m} serverId={server.id} />
          ))}
          {music && <DjRow music={music} />}
        </ul>
      )}
    </div>
  );
}

/** O bot de música: aparece na call enquanto toca alguma coisa. */
function DjRow({ music }: { music: NowPlaying }) {
  return (
    <li
      className="flex h-8 items-center gap-2 rounded-[8px] px-1.5 text-[13.5px] text-oat/70"
      title={`${music.playing ? "Tocando" : "Pausado"}: ${music.title}${music.author ? ` · ${music.author}` : ""} (pedido por ${music.owner_name})`}
      aria-label={`DJ da call ${music.playing ? "tocando" : "pausado"}: ${music.title}`}
    >
      <span className={`grid size-[22px] shrink-0 place-items-center rounded-full bg-ember text-white ${music.playing ? "ring-2 ring-moss" : ""}`}>
        <Music2 className="size-3" />
      </span>
      <span className="min-w-0 flex-1 truncate">
        <span className="font-semibold text-oat/90">DJ</span> · {music.title}
      </span>
      {music.playing ? <span aria-hidden className="eq-bars shrink-0"><i /><i /><i /></span> : <Pause className="size-3.5 opacity-60" />}
      <span className="shrink-0 rounded-[5px] bg-ember/80 px-1 text-[9.5px] font-bold uppercase tracking-wide text-white">bot</span>
    </li>
  );
}

function VoiceMemberRow({ m, serverId }: { m: VoiceMember; serverId: string }) {
  const user = useUser(m.user_id);
  const v = useVoice();
  const me = useStore((s) => s.me);
  const server = useStore((s) => s.servers[serverId]);
  const game = useStore((s) => s.games[m.user_id]);
  const speaking = v.call.peers.find((p) => p.identity === m.user_id)?.speaking;
  if (!user) return null;
  // você pode se arrastar para outra sala; admin arrasta os outros
  const canDrag = m.user_id === me?.id || canModerate(server, me?.id, m.user_id);
  return (
    <li>
      <button
        type="button"
        {...dragProps(m.user_id, canDrag)}
        onClick={(e) => openProfile(user.id, e.currentTarget, serverId)}
        onContextMenu={(e) => openUserMenu(e, user.id, serverId)}
        title={game ? `Jogando ${game.name}` : undefined}
        className="group flex h-8 w-full items-center gap-2 rounded-[8px] px-1.5 text-left text-[13.5px] text-oat/70 hover:bg-cocoa-3 hover:text-oat"
      >
        <Avatar name={user.display_name} avatar={user.avatar} accent={user.accent} size={22} ring={speaking ? "var(--color-moss)" : undefined} />
        <span className="min-w-0 flex-1 truncate">{user.display_name}</span>
        {m.stream && <span className="rounded-[5px] bg-rust px-1 text-[9.5px] font-bold uppercase tracking-wide text-oat">ao vivo</span>}
        {m.video && <Video className="size-3.5 opacity-60" />}
        {m.sdeaf ? (
          <HeadphoneOff className="size-3.5 text-honey" aria-label="Sem som (admin)" />
        ) : m.smute ? (
          <MicOff className="size-3.5 text-honey" aria-label="Mutado por um admin" />
        ) : m.deaf ? (
          <HeadphoneOff className="size-3.5 text-rust" aria-label="Sem som" />
        ) : (
          !m.mic && <MicOff className="size-3.5 text-rust" aria-label="Mudo" />
        )}
      </button>
    </li>
  );
}
