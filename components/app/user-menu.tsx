"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowRightLeft, Gamepad2, Tag, HeadphoneOff, MessageCircle, MicOff, PhoneOff, UserRound, Volume2, VolumeX } from "lucide-react";
import { api, errorText } from "@/lib/api";
import { useStore, useUser } from "@/lib/store";
import { closeUserMenu, toast, useUI } from "@/lib/ui";
import { useVoice } from "@/lib/voice";
import type { Server } from "@/lib/types";
import { Avatar } from "./bits";
import { useOpenDm } from "./friends";

const RANK = { member: 0, admin: 1, owner: 2 } as const;

/** Em que canal de voz do servidor a pessoa está agora. */
function voiceChannelOf(server: Server | undefined, userId: string, voice: Record<string, { user_id: string }[]>) {
  return server?.channels.find((c) => c.type === "voice" && voice[c.id]?.some((m) => m.user_id === userId));
}

/** Pode mexer na call dos outros? Admin sobre quem tem cargo menor (o dono pode tudo); cargo com "Moderar call" sobre membros comuns. */
export function canModerate(server: Server | undefined, meId: string | undefined, targetId: string) {
  if (!server || !meId || meId === targetId) return false;
  const mine = server.members.find((m) => m.user.id === meId)?.role ?? "member";
  const theirs = server.members.find((m) => m.user.id === targetId)?.role ?? "member";
  if (RANK[mine] >= 1) return mine === "owner" || RANK[mine] > RANK[theirs];
  return theirs === "member" && !!server.my_perms?.includes("moderar_voz");
}

/** Pode mudar o apelido dessa pessoa neste servidor? O seu sempre; o dos outros com a permissão "Apelidos" (o do dono, só ele). */
export function canRename(server: Server | undefined, meId: string | undefined, targetId: string) {
  if (!server || !meId) return false;
  const target = server.members.find((m) => m.user.id === targetId);
  if (!target) return false;
  if (meId === targetId) return true;
  return target.role !== "owner" && !!server.my_perms?.includes("apelidos");
}

export async function moveToChannel(server: Server, userId: string, channelId: string, meId: string | undefined, join: (cid: string) => Promise<void>) {
  if (userId === meId) {
    await join(channelId);
    return;
  }
  try {
    await api(`/servers/${server.id}/voice/${userId}/move`, { json: { channel_id: channelId } });
    const ch = server.channels.find((c) => c.id === channelId);
    toast(`Levando para ${ch?.name ?? "a outra sala"}…`);
  } catch (e) {
    toast(errorText(e));
  }
}

/* ------------------------------------------------------------------ */
/* arrastar alguém da call para outra sala (segurando no perfil)       */
/* ------------------------------------------------------------------ */

const DRAG_TYPE = "application/x-cdg-voice-user";

export function dragProps(userId: string, enabled: boolean) {
  if (!enabled) return {};
  return {
    draggable: true,
    onDragStart: (e: React.DragEvent) => {
      e.dataTransfer.setData(DRAG_TYPE, userId);
      e.dataTransfer.effectAllowed = "move";
    },
  };
}

export function useDropTarget(onDropUser: (userId: string) => void) {
  const [over, setOver] = useState(false);
  return {
    over,
    props: {
      onDragOver: (e: React.DragEvent) => {
        if (!e.dataTransfer.types.includes(DRAG_TYPE)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        setOver(true);
      },
      onDragLeave: () => setOver(false),
      onDrop: (e: React.DragEvent) => {
        setOver(false);
        const id = e.dataTransfer.getData(DRAG_TYPE);
        if (!id) return;
        e.preventDefault();
        onDropUser(id);
      },
    },
  };
}

/* ------------------------------------------------------------------ */
/* menu do botão direito                                               */
/* ------------------------------------------------------------------ */

export function UserMenu() {
  const menu = useUI((s) => s.userMenu);
  if (!menu) return null;
  return <MenuBody key={`${menu.id}-${menu.x}-${menu.y}`} {...menu} />;
}

function MenuBody({ id, x, y, serverId }: { id: string; x: number; y: number; serverId?: string }) {
  const user = useUser(id);
  const me = useStore((s) => s.me);
  const server = useStore((s) => (serverId ? s.servers[serverId] : undefined));
  const voice = useStore((s) => s.voice);
  const game = useStore((s) => s.games[id]);
  const v = useVoice();
  const openDm = useOpenDm();
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });
  const [nick, setNick] = useState<string | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setPos({
      left: Math.max(8, Math.min(x, window.innerWidth - el.offsetWidth - 8)),
      top: Math.max(8, Math.min(y, window.innerHeight - el.offsetHeight - 8)),
    });
  }, [x, y]);

  // abre já com o primeiro item focado: setas andam, letra sublinhada faz a ação
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('[role^="menuitem"]')?.focus({ preventScroll: true });
  }, []);

  function onMenuKey(e: React.KeyboardEvent<HTMLDivElement>) {
    const root = ref.current;
    if (!root || e.ctrlKey || e.metaKey || e.altKey) return;
    const items = [...root.querySelectorAll<HTMLElement>('[role^="menuitem"], input[type="range"]')];
    const at = items.indexOf(document.activeElement as HTMLElement);
    const go = (i: number) => {
      e.preventDefault();
      items[(i + items.length) % items.length]?.focus();
    };
    if (e.key === "ArrowDown") return go(at + 1);
    if (e.key === "ArrowUp") return go(at < 0 ? items.length - 1 : at - 1);
    if (e.key === "Home") return go(0);
    if (e.key === "End") return go(items.length - 1);
    if (e.key === "Tab") return go(at + (e.shiftKey ? -1 : 1));
    if (e.key.length === 1) {
      const hit = root.querySelector<HTMLElement>(`[data-hotkey="${e.key.toLowerCase()}"]`);
      if (hit) {
        e.preventDefault();
        hit.click();
      }
    }
  }

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) closeUserMenu();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && closeUserMenu();
    const t = window.setTimeout(() => {
      window.addEventListener("mousedown", onDown);
      window.addEventListener("contextmenu", onDown);
    }, 0);
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", closeUserMenu);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("contextmenu", onDown);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", closeUserMenu);
    };
  }, []);

  if (!user) return null;
  const isMe = id === me?.id;
  const inMyCall = !!v.channelId && v.call.peers.some((p) => p.identity === id && !p.isLocal);
  const theirChannel = voiceChannelOf(server, id, voice);
  const state = theirChannel ? voice[theirChannel.id]?.find((m) => m.user_id === id) : undefined;
  const mod = canModerate(server, me?.id, id);
  const vol = v.voiceVol[id] ?? 1;
  const otherRooms = server?.channels.filter((c) => c.type === "voice" && c.id !== theirChannel?.id) ?? [];
  const rename = canRename(server, me?.id, id);
  const currentNick = server?.members.find((m) => m.user.id === id)?.nickname ?? "";

  async function saveNick(value: string) {
    try {
      await api(`/servers/${server!.id}/members/${id}`, { method: "PATCH", json: { nickname: value.trim() } });
      toast(value.trim() ? `Apelido agora é ${value.trim()}.` : "Apelido tirado.");
      closeUserMenu();
    } catch (e) {
      toast(errorText(e));
    }
  }

  async function setMods(body: { mute?: boolean; deaf?: boolean; gain?: number }) {
    try {
      await api(`/servers/${server!.id}/voice/${id}`, { method: "PATCH", json: body });
    } catch (e) {
      toast(errorText(e));
    }
  }

  return (
    <div
      ref={ref}
      role="menu"
      aria-label={`Opções de ${user.display_name}`}
      className="pop-in fixed z-[70] w-[248px] overflow-y-auto rounded-[14px] bg-cocoa-0 p-1.5 text-[13.5px] shadow-[0_12px_40px_rgb(0_0_0/0.45)]"
      style={{ left: pos.left, top: pos.top, maxHeight: "calc(100svh - 16px)" }}
      onContextMenu={(e) => e.preventDefault()}
      onKeyDown={onMenuKey}
    >
      <div className="flex items-center gap-2.5 px-2 pb-2 pt-1.5">
        <Avatar name={user.display_name} avatar={user.avatar} accent={user.accent} size={32} />
        <div className="min-w-0">
          <p className="truncate font-semibold">{user.display_name}</p>
          {game ? (
            <p className="flex items-center gap-1 truncate text-[12px] text-moss">
              <Gamepad2 className="size-3.5 shrink-0" /> {game.name}
            </p>
          ) : (
            <p className="truncate text-[12px] text-oat/45">@{user.username}</p>
          )}
        </div>
      </div>

      <Item
        icon={<UserRound />}
        hotkey="p"
        onClick={() => {
          const r = new DOMRect(x, y, 0, 0);
          useUI.setState({ userMenu: null, profile: { id, rect: r, serverId } });
        }}
      >
        Ver perfil
      </Item>
      {!isMe && !user.bot && (
        <Item
          icon={<MessageCircle />}
          hotkey="c"
          onClick={() => {
            closeUserMenu();
            void openDm(id);
          }}
        >
          Mandar mensagem
        </Item>
      )}

      {rename &&
        (nick === null ? (
          <Item icon={<Tag />} hotkey="a" onClick={() => setNick(currentNick)}>
            {isMe ? "Mudar meu apelido" : "Mudar apelido"}
          </Item>
        ) : (
          <form
            className="px-2 py-1.5"
            onSubmit={(e) => {
              e.preventDefault();
              void saveNick(nick);
            }}
          >
            <input
              autoFocus
              className="field h-9 !py-0 text-[13.5px]"
              value={nick}
              maxLength={32}
              placeholder={user.display_name}
              onChange={(e) => setNick(e.target.value)}
              onKeyDown={(e) => e.key !== "Escape" && e.stopPropagation()}
              aria-label={`Apelido de ${user.display_name} neste servidor`}
            />
            <p className="mt-1 text-[11.5px] text-oat/40">Enter salva · vazio volta ao nome normal</p>
          </form>
        ))}

      {inMyCall && (
        <>
          <Sep />
          <div className="px-2 py-1.5">
            <p className="mb-1.5 flex justify-between text-[12px] text-oat/55">
              Volume para você <span className="tabular-nums">{Math.round(vol * 100)}%</span>
            </p>
            <input
              type="range"
              className="range w-full text-oat"
              min={0}
              max={1}
              step={0.05}
              value={vol}
              style={{ ["--fill" as string]: `${vol * 100}%` }}
              onChange={(e) => v.setVoiceVol(id, Number(e.target.value))}
              aria-label={`Volume de ${user.display_name} para você`}
            />
          </div>
          <Item icon={v.localMute[id] ? <Volume2 /> : <VolumeX />} hotkey="s" onClick={() => v.setLocalMute(id, !v.localMute[id])} checked={!!v.localMute[id]}>
            Silenciar para mim
          </Item>
        </>
      )}

      {mod && theirChannel && server && (
        <>
          <Sep />
          <p className="label px-2 pb-1 pt-1.5 text-oat/40">Para todos (moderação)</p>
          <Item icon={<MicOff />} hotkey="m" onClick={() => void setMods({ mute: !state?.smute })} checked={!!state?.smute}>
            Mutar para todos
          </Item>
          <Item icon={<HeadphoneOff />} hotkey="e" onClick={() => void setMods({ deaf: !state?.sdeaf })} checked={!!state?.sdeaf}>
            Ensurdecer para todos
          </Item>
          <GainSlider initial={state?.gain ?? 1} name={user.display_name} onCommit={(g) => void setMods({ gain: g })} />
          {otherRooms.length > 0 && (
            <>
              <p className="flex items-center gap-1.5 px-2 pb-1 pt-2 text-[12px] text-oat/55">
                <ArrowRightLeft className="size-3.5" /> Mover para
              </p>
              {otherRooms.map((c) => (
                <Item
                  key={c.id}
                  icon={<Volume2 />}
                  onClick={() => {
                    closeUserMenu();
                    void moveToChannel(server, id, c.id, me?.id, v.join);
                  }}
                >
                  {c.name}
                </Item>
              ))}
            </>
          )}
          <Sep />
          <Item
            icon={<PhoneOff />}
            hotkey="d"
            danger
            onClick={async () => {
              closeUserMenu();
              try {
                await api(`/servers/${server.id}/voice/${id}/disconnect`, { method: "POST" });
                toast(`${user.display_name} saiu da call.`);
              } catch (e) {
                toast(errorText(e));
              }
            }}
          >
            Desconectar da call
          </Item>
        </>
      )}
    </div>
  );
}

function GainSlider({ initial, name, onCommit }: { initial: number; name: string; onCommit: (g: number) => void }) {
  const [g, setG] = useState(initial);
  const timer = useRef<number | undefined>(undefined);
  return (
    <div className="px-2 py-1.5">
      <p className="mb-1.5 flex justify-between text-[12px] text-oat/55">
        Volume para todos <span className="tabular-nums">{Math.round(g * 100)}%</span>
      </p>
      <input
        type="range"
        className="range w-full text-oat"
        min={0}
        max={1}
        step={0.05}
        value={g}
        style={{ ["--fill" as string]: `${g * 100}%` }}
        onChange={(e) => {
          const n = Number(e.target.value);
          setG(n);
          window.clearTimeout(timer.current);
          timer.current = window.setTimeout(() => onCommit(n), 350);
        }}
        aria-label={`Volume de ${name} para todos`}
      />
    </div>
  );
}

function Item({
  icon,
  children,
  onClick,
  danger,
  checked,
  hotkey,
}: {
  icon: React.ReactNode;
  children: React.ReactNode;
  onClick: () => void;
  danger?: boolean;
  checked?: boolean;
  /** tecla que faz a ação com o menu aberto */
  hotkey?: string;
}) {
  return (
    <button
      type="button"
      role={checked === undefined ? "menuitem" : "menuitemcheckbox"}
      aria-checked={checked}
      aria-keyshortcuts={hotkey?.toUpperCase()}
      data-hotkey={hotkey}
      onClick={onClick}
      className={`flex w-full items-center gap-2.5 rounded-[9px] px-2 py-[7px] text-left outline-none [&_svg]:size-4 [&_svg]:shrink-0 ${
        danger ? "text-[#ff8a8f] hover:bg-rust hover:text-oat focus-visible:bg-rust focus-visible:text-oat" : "text-oat/85 hover:bg-ember hover:text-white focus-visible:bg-ember focus-visible:text-white"
      }`}
    >
      {icon}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {hotkey && <kbd className="font-sans text-[11px] uppercase opacity-45">{hotkey}</kbd>}
      {checked !== undefined && (
        <span className={`grid size-4 place-items-center rounded-[5px] border ${checked ? "border-ember bg-ember" : "border-oat/30"}`}>
          {checked && <span className="size-1.5 rounded-full bg-white" />}
        </span>
      )}
    </button>
  );
}

function Sep() {
  return <div className="mx-2 my-1 h-px bg-oat/[0.08]" />;
}
