"use client";

import { nameColorOf } from "@/lib/badges";
import Link from "next/link";
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { FileText, Hash, MessageSquare, Pencil, Phone, PhoneOff, Plus, Reply, SmilePlus, Sticker as StickerIcon, Trash2, Users, X } from "lucide-react";
import { api, errorText, upload } from "@/lib/api";
import { idGt, loadMessages, markRead, sendMessage, sendTyping, useStore, useUser, usePresence } from "@/lib/store";
import { openProfile, toast, useUI } from "@/lib/ui";
import { useVoice } from "@/lib/voice";
import { dayOf, isSameDay, sizeOf, stampOf, timeOf } from "@/lib/format";
import type { Attachment, Channel, CustomEmoji, Dm, Member, Message, Server, User } from "@/lib/types";
import { useTicker } from "@/components/room/media";
import { Avatar, Popover, useAnchor } from "./bits";
import { EmojiPicker, QUICK_REACTIONS } from "./emoji-picker";
import { HypeLine } from "./hype";
import { GifView, StickerPicker, StickerView } from "./stickers";
import { RichText, isJumbo } from "./rich-text";
import { CallStage } from "./voice-view";

const EMPTY: Message[] = [];

export function ChatView({ channelId, server, channel, dm }: { channelId: string; server?: Server; channel?: Channel; dm?: Dm }) {
  const v = useVoice();
  const inThisCall = v.channelId === channelId;
  const callers = useStore((s) => s.voice[channelId]) ?? [];
  const other = dm?.recipients[0];
  const otherUser = useUser(other?.id) ?? other;
  const otherStatus = usePresence(other?.id);
  const showMembers = useUI((s) => s.showMembers);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* cabeçalho */}
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-cocoa-0/50 px-3 sm:px-4">
        <button type="button" onClick={() => useUI.setState({ navOpen: true })} className="press -ml-1 rounded-md p-1.5 text-oat/60 hover:text-oat md:hidden" aria-label="Abrir menu">
          <Hash className="size-5" />
        </button>
        {channel && (
          <>
            <Hash className="hidden size-5 shrink-0 text-oat/40 md:block" />
            <h1 className="shrink-0 font-semibold">{channel.name}</h1>
            {channel.topic && <p className="hidden min-w-0 truncate border-l border-oat/10 pl-3 text-[13.5px] text-oat/50 sm:block">{channel.topic}</p>}
          </>
        )}
        {otherUser && (
          <button type="button" onClick={(e) => openProfile(otherUser.id, e.currentTarget)} className="group flex min-w-0 items-center gap-2.5" style={{ ["--dot-ring" as string]: "var(--color-cocoa-3)" }}>
            <Avatar name={otherUser.display_name} avatar={otherUser.avatar} accent={otherUser.accent} size={28} status={otherStatus} />
            <span className="truncate font-semibold">{otherUser.display_name}</span>
            {otherUser.custom_status && <span className="hidden truncate text-[13px] text-oat/45 sm:inline">{otherUser.custom_status}</span>}
          </button>
        )}
        <div className="ml-auto flex items-center gap-1">
          {dm &&
            (inThisCall ? (
              <button type="button" onClick={() => void v.leave()} className="press flex h-8 items-center gap-2 rounded-[9px] bg-rust px-3 text-[13px] font-semibold text-oat" aria-label="Desligar">
                <PhoneOff className="size-4" /> Desligar
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void v.join(channelId)}
                disabled={!!v.joining}
                className="press flex h-8 items-center gap-2 rounded-[9px] px-3 text-[13px] font-semibold text-oat/75 hover:bg-cocoa-4 hover:text-oat"
                title={callers.length ? "Entrar na chamada" : "Ligar"}
              >
                <Phone className="size-4" /> {callers.length ? "Entrar na chamada" : "Ligar"}
              </button>
            ))}
          {server && (
            <button
              type="button"
              onClick={() => useUI.setState({ showMembers: !showMembers })}
              aria-pressed={showMembers}
              title="Membros"
              className={`press hidden size-8 place-items-center rounded-[9px] lg:grid ${showMembers ? "text-oat" : "text-oat/45 hover:text-oat"}`}
            >
              <Users className="size-[18px]" />
            </button>
          )}
        </div>
      </header>

      {dm && inThisCall && (
        <div className="h-[46%] min-h-[240px] shrink-0 border-b border-cocoa-0/50 bg-cocoa-1">
          <CallStage compact />
        </div>
      )}
      {dm && !inThisCall && callers.length > 0 && (
        <div className="flex shrink-0 items-center gap-3 border-b border-cocoa-0/50 bg-moss/10 px-4 py-2 text-[13.5px]">
          <span className="live-dot !bg-moss" />
          <span className="flex-1">{otherUser?.display_name} está te chamando.</span>
          <button type="button" onClick={() => void v.join(channelId)} className="press rounded-[9px] bg-moss px-3 py-1.5 font-semibold text-cocoa-0">
            Atender
          </button>
        </div>
      )}

      <MessageList channelId={channelId} server={server} channel={channel} dm={dm} />
      <Composer channelId={channelId} server={server} placeholder={channel ? `Escreva em #${channel.name}` : `Mensagem para ${otherUser?.display_name ?? ""}`} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* lista de mensagens                                                  */
/* ------------------------------------------------------------------ */

/** Chat de texto de um canal de voz, ao lado da call. */
export function CallChat({ channel, server }: { channel: Channel; server: Server }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <MessageList channelId={channel.id} server={server} channel={channel} />
      <Composer channelId={channel.id} server={server} placeholder={`Conversar em ${channel.name}`} />
    </div>
  );
}

function MessageList({ channelId, server, channel, dm }: { channelId: string; server?: Server; channel?: Channel; dm?: Dm }) {
  const items = useStore((s) => s.messages[channelId]?.items) ?? EMPTY;
  const state = useStore((s) => s.messages[channelId]);
  const me = useStore((s) => s.me)!;
  const ref = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  const prevHeight = useRef(0);
  const prevFirst = useRef<string | null>(null);
  // o "novas mensagens" fica parado onde estava a leitura quando você abriu o canal
  const [readMark] = useState(() => useStore.getState().reads[channelId] ?? null);

  useEffect(() => {
    void loadMessages(channelId);
  }, [channelId]);

  // mantém a posição: no fim quando chega mensagem nova, no lugar quando carrega antigas
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const first = items[0]?.id ?? null;
    if (prevFirst.current && first !== prevFirst.current && prevHeight.current) {
      el.scrollTop += el.scrollHeight - prevHeight.current;
    } else if (atBottom.current) {
      el.scrollTop = el.scrollHeight;
    }
    prevFirst.current = first;
    prevHeight.current = el.scrollHeight;
  }, [items]);

  // imagens que terminam de carregar empurram o fim
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      if (atBottom.current) el.scrollTop = el.scrollHeight;
      prevHeight.current = el.scrollHeight;
    });
    if (el.firstElementChild) ro.observe(el.firstElementChild);
    return () => ro.disconnect();
  }, [channelId]);

  const last = items[items.length - 1];
  useEffect(() => {
    if (!last || last.pending) return;
    const mark = () => {
      if (document.hasFocus() && atBottom.current) markRead(channelId, last.id);
    };
    mark();
    window.addEventListener("focus", mark);
    return () => window.removeEventListener("focus", mark);
  }, [channelId, last]);

  const onScroll = () => {
    const el = ref.current!;
    atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
    if (el.scrollTop < 300 && state?.hasMore && !state.loading) void loadMessages(channelId, true);
    if (atBottom.current && last) markRead(channelId, last.id);
  };

  const emojis = server?.emojis ?? [];
  const members = server?.members;
  const firstUnread = readMark ? items.find((m) => idGt(m.id, readMark) && m.author?.id !== me.id)?.id : null;

  return (
    <div ref={ref} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
      <div className="flex min-h-full flex-col justify-end pb-4">
        {state?.loaded && !state.hasMore && <Welcome channel={channel} dm={dm} server={server} />}
        {state?.loading && <p className="py-4 text-center text-[13px] text-oat/40">Carregando conversa…</p>}
        {items.map((m, i) => {
          const prev = items[i - 1];
          const newDay = !prev || !isSameDay(prev.created_at, m.created_at);
          const grouped =
            !newDay &&
            prev &&
            prev.kind === "default" &&
            m.kind === "default" &&
            prev.author?.id === m.author?.id &&
            !m.reply_to &&
            new Date(m.created_at).getTime() - new Date(prev.created_at).getTime() < 7 * 60 * 1000;
          return (
            <div key={m.nonce ?? m.id}>
              {newDay && (
                <div className="my-4 flex items-center gap-3 px-4">
                  <span className="h-px flex-1 bg-oat/[0.08]" />
                  <span className="font-display text-[13px] text-oat/45">{dayOf(m.created_at)}</span>
                  <span className="h-px flex-1 bg-oat/[0.08]" />
                </div>
              )}
              {m.id === firstUnread && (
                <div className="my-1 flex items-center gap-2 px-4" role="separator">
                  <span className="h-px flex-1 bg-ember/70" />
                  <span className="rounded-[5px] bg-ember px-1.5 text-[10.5px] font-bold uppercase tracking-wide text-white">novas</span>
                </div>
              )}
              <MessageItem msg={m} grouped={!!grouped} me={me} emojis={emojis} members={members} serverId={server?.id} canModerate={canModerate(server, me.id)} />
            </div>
          );
        })}
      </div>
    </div>
  );
}

function canModerate(server: Server | undefined, uid: string) {
  const role = server?.members.find((m) => m.user.id === uid)?.role;
  return role === "owner" || role === "admin";
}

function Welcome({ channel, dm, server }: { channel?: Channel; dm?: Dm; server?: Server }) {
  const other = dm?.recipients[0];
  return (
    <div className="px-4 pb-4 pt-10">
      {other ? (
        <>
          <Avatar name={other.display_name} avatar={other.avatar} accent={other.accent} size={72} play />
          <h2 className="mt-4 font-display text-[34px] leading-tight">{other.display_name}</h2>
          <p className="text-[14px] text-oat/50">@{other.username}</p>
          <p className="mt-3 max-w-lg text-[14.5px] text-oat/60">O começo da conversa de vocês. Mande um oi, um meme ou chama pra call.</p>
        </>
      ) : channel?.type === "voice" ? (
        <>
          <span className="grid size-12 place-items-center rounded-[16px] bg-cocoa-4 text-oat/70">
            <MessageSquare className="size-6" />
          </span>
          <h2 className="mt-3 font-display text-[24px] leading-tight">Chat da call</h2>
          <p className="mt-1 text-[13.5px] text-oat/55">Link, print, &quot;tô sem mic&quot;: o que for da call fica aqui, sem bagunçar os outros canais.</p>
        </>
      ) : (
        <>
          <span className="grid size-16 place-items-center rounded-[20px] bg-cocoa-4 text-oat/70">
            <Hash className="size-8" />
          </span>
          <h2 className="mt-4 font-display text-[34px] leading-tight">
            Boas-vindas a <span className="italic">#{channel?.name}</span>
          </h2>
          <p className="mt-1 max-w-lg text-[14.5px] text-oat/55">
            {channel?.topic ? `${channel.topic}. ` : ""}Esse é o comecinho do canal em {server?.name}. Puxa uma cadeira.
          </p>
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* uma mensagem                                                        */
/* ------------------------------------------------------------------ */

const JOIN_LINES = [
  (n: string) => `${n} chegou. Alguém passa a pipoca.`,
  (n: string) => `${n} entrou pela porta da cozinha.`,
  (n: string) => `${n} puxou uma cadeira.`,
  (n: string) => `Olha quem apareceu: ${n}!`,
  (n: string) => `${n} chegou trazendo salgadinho.`,
];

const MessageItem = memo(function MessageItem({
  msg,
  grouped,
  me,
  emojis,
  members,
  serverId,
  canModerate,
}: {
  msg: Message;
  grouped: boolean;
  me: User;
  emojis: CustomEmoji[];
  members?: Member[];
  serverId?: string;
  canModerate: boolean;
}) {
  const author = useUser(msg.author?.id) ?? msg.author;
  const [editing, setEditing] = useState(false);
  const picker = useAnchor<HTMLButtonElement>();
  const mine = author?.id === me.id;
  const mentionsMe = new RegExp(`(^|[^\\w@])@${me.username.replace(/\./g, "\\.")}(?![\\w.])`, "i").test(msg.content);
  const nick = members?.find((m) => m.user.id === author?.id)?.nickname;
  const name = nick || author?.display_name || "Alguém que saiu";
  const welcome = useStore((s) => (serverId ? s.servers[serverId]?.welcome_lines : undefined));

  const onMention = useCallback(
    (username: string, el: HTMLElement) => {
      const u = members?.find((m) => m.user.username.toLowerCase() === username.toLowerCase())?.user ?? Object.values(useStore.getState().users).find((x) => x.username === username.toLowerCase());
      if (u) openProfile(u.id, el, serverId);
    },
    [members, serverId],
  );

  if (msg.kind === "hype") return <HypeLine channelId={msg.content} name={name} stamp={stampOf(msg.created_at)} serverId={serverId} />;

  if (msg.kind === "join") {
    const custom = welcome?.length ? welcome : null;
    const pick = Number(BigInt(msg.id) % BigInt(custom ? custom.length : JOIN_LINES.length));
    const line = custom ? (n: string) => custom[pick].split("{nome}").join(n) : JOIN_LINES[pick];
    return (
      <div className="group flex items-center gap-3 px-4 py-1.5 text-[14px] text-oat/55 hover:bg-cocoa-2/40">
        <span className="w-10 text-center text-[16px]" aria-hidden>
          ☕
        </span>
        <span>
          {line(name)} <span className="ml-1 text-[11.5px] text-oat/30">{stampOf(msg.created_at)}</span>
        </span>
      </div>
    );
  }

  if (msg.kind === "hall") {
    return (
      <div className="group flex items-center gap-3 px-4 py-1.5 text-[14px] text-oat/60 hover:bg-cocoa-2/40">
        <span className="w-10 text-center text-[16px]" aria-hidden>
          🏆
        </span>
        <span>
          A{" "}
          <button
            type="button"
            onClick={() => msg.reply_to && document.getElementById(`m-${msg.reply_to.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" })}
            className="font-semibold text-oat hover:underline"
          >
            mensagem de {name}
          </button>{" "}
          entrou para o{" "}
          {serverId ? (
            <Link href={`/app/s/${serverId}/hall`} className="font-semibold text-ember-2 hover:underline">
              Hall da Fama
            </Link>
          ) : (
            "Hall da Fama"
          )}
          . <span className="ml-1 text-[11.5px] text-oat/30">{stampOf(msg.created_at)}</span>
        </span>
      </div>
    );
  }

  async function toggleReaction(emoji: string) {
    const has = msg.reactions.find((r) => r.emoji === emoji)?.me;
    try {
      await api(`/messages/${msg.id}/reactions/${encodeURIComponent(emoji)}`, { method: has ? "DELETE" : "PUT" });
    } catch (e) {
      toast(errorText(e));
    }
  }

  async function remove() {
    if (!confirm("Apagar essa mensagem?")) return;
    try {
      await api(`/messages/${msg.id}`, { method: "DELETE" });
    } catch (e) {
      toast(errorText(e));
    }
  }

  const jumbo = !msg.attachments.length && isJumbo(msg.content);

  return (
    <div
      id={`m-${msg.id}`}
      className={`group relative px-4 transition-colors hover:bg-cocoa-2/45 ${grouped ? "py-0.5" : "mt-3 pt-1 pb-0.5"} ${msg.pending ? "opacity-55" : ""} ${
        mentionsMe ? "border-l-2 border-ember bg-ember/[0.07] hover:bg-ember/[0.1]" : ""
      }`}
    >
      {msg.reply_to && (
        <button
          type="button"
          onClick={() => document.getElementById(`m-${msg.reply_to!.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" })}
          className="mb-1 ml-[52px] flex max-w-full items-center gap-1.5 truncate text-[12.5px] text-oat/50 hover:text-oat/80"
        >
          <span className="h-2.5 w-5 shrink-0 rounded-tl-md border-l-2 border-t-2 border-oat/20" />
          <span className="font-semibold">{msg.reply_to.author_name}</span>
          <span className="truncate">{msg.reply_to.content || (msg.reply_to.has_attachments ? "📎 anexo" : "")}</span>
        </button>
      )}
      {msg.reply_missing && !msg.reply_to && <p className="mb-1 ml-[52px] text-[12px] italic text-oat/35">respondendo a uma mensagem apagada</p>}

      <div className="flex gap-3">
        <div className="w-10 shrink-0">
          {grouped ? (
            <span className="block pt-1 text-right text-[10.5px] tabular-nums text-oat/0 group-hover:text-oat/35">{timeOf(msg.created_at)}</span>
          ) : (
            author && (
              <button type="button" onClick={(e) => !author.bot && openProfile(author.id, e.currentTarget, serverId)} className="press mt-0.5 block rounded-full" aria-label={`Perfil de ${name}`}>
                <Avatar name={author.display_name} avatar={author.avatar} accent={author.accent} size={40} />
              </button>
            )
          )}
        </div>
        <div className="min-w-0 flex-1">
          {!grouped && (
            <p className="flex items-baseline gap-2">
              <button
                type="button"
                onClick={(e) => author && !author.bot && openProfile(author.id, e.currentTarget, serverId)}
                className="truncate text-[15px] font-semibold hover:underline"
                style={{ color: nameColorOf(author) }}
              >
                {name}
              </button>
              {author?.bot && <span className="shrink-0 self-center rounded-[5px] bg-ember px-1.5 py-px text-[10px] font-bold uppercase tracking-wide text-white">Bot</span>}
              <span className="shrink-0 text-[11.5px] text-oat/35">{stampOf(msg.created_at)}</span>
            </p>
          )}
          {editing ? (
            <EditBox msg={msg} onDone={() => setEditing(false)} />
          ) : (
            msg.content && (
              <div className={`break-words leading-[1.45] text-oat/[0.92] ${jumbo ? "text-[42px] leading-[1.15]" : "text-[15px]"}`}>
                <RichText text={msg.content} emojis={emojis} meUsername={me.username} onMention={onMention} />
                {msg.edited_at && <span className="ml-1 text-[11px] text-oat/30">(editada)</span>}
              </div>
            )
          )}
          {msg.attachments.length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-2">
              {msg.attachments.map((a) => (
                <AttachmentView key={a.id ?? a.url} a={a} mine={mine} />
              ))}
            </div>
          )}
          {msg.reactions.length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-1">
              {msg.reactions.map((r) => (
                <button
                  key={r.emoji}
                  type="button"
                  onClick={() => void toggleReaction(r.emoji)}
                  className={`press flex h-7 items-center gap-1.5 rounded-full border px-2 text-[13px] ${
                    r.me ? "border-ember/60 bg-ember/15 text-oat" : "border-transparent bg-cocoa-2 text-oat/70 hover:border-oat/15"
                  }`}
                >
                  <ReactionGlyph emoji={r.emoji} emojis={emojis} />
                  <span className="font-semibold tabular-nums">{r.count}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ferramentas no hover */}
      {!msg.pending && !editing && (
        <div className="absolute -top-4 right-4 z-10 hidden items-center rounded-[10px] border border-oat/[0.08] bg-cocoa-2 p-0.5 group-hover:flex">
          {QUICK_REACTIONS.slice(0, 3).map((e) => (
            <button key={e} type="button" onClick={() => void toggleReaction(e)} className="press grid size-8 place-items-center rounded-[8px] text-[17px] hover:bg-cocoa-4">
              {e}
            </button>
          ))}
          <ToolButton label="Reagir" onClick={(el) => picker.open(el)}>
            <SmilePlus />
          </ToolButton>
          <ToolButton label="Responder" onClick={() => window.dispatchEvent(new CustomEvent("cdg:reply", { detail: msg }))}>
            <Reply />
          </ToolButton>
          {mine && (
            <ToolButton label="Editar" onClick={() => setEditing(true)}>
              <Pencil />
            </ToolButton>
          )}
          {(mine || canModerate) && (
            <ToolButton label="Apagar" onClick={() => void remove()} danger>
              <Trash2 />
            </ToolButton>
          )}
        </div>
      )}
      <Popover anchor={picker.rect} onClose={picker.close} side="left">
        <EmojiPicker
          emojis={emojis}
          onPick={(e) => {
            picker.close();
            void toggleReaction(e);
          }}
        />
      </Popover>
    </div>
  );
});

export function ReactionGlyph({ emoji, emojis }: { emoji: string; emojis: CustomEmoji[] }) {
  const custom = emoji.startsWith(":") ? emojis.find((e) => `:${e.name}:` === emoji) : null;
  if (custom) return <img src={custom.url} alt={emoji} className="size-[18px] object-contain" />;
  return <span className="text-[15px] leading-none">{emoji}</span>;
}

function ToolButton({ label, onClick, danger, children }: { label: string; onClick: (el: HTMLButtonElement) => void; danger?: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={(e) => onClick(e.currentTarget)}
      className={`press grid size-8 place-items-center rounded-[8px] [&_svg]:size-[17px] ${danger ? "text-rust hover:bg-rust/15" : "text-oat/65 hover:bg-cocoa-4 hover:text-oat"}`}
    >
      {children}
    </button>
  );
}

function EditBox({ msg, onDone }: { msg: Message; onDone: () => void }) {
  const [text, setText] = useState(msg.content);
  const save = async () => {
    if (text.trim() && text.trim() !== msg.content) {
      try {
        await api(`/messages/${msg.id}`, { method: "PATCH", json: { content: text } });
      } catch (e) {
        toast(errorText(e));
      }
    }
    onDone();
  };
  return (
    <div className="mt-1">
      <AutoTextarea
        value={text}
        onChange={setText}
        autoFocus
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            void save();
          }
          if (e.key === "Escape") onDone();
        }}
        className="w-full rounded-[10px] bg-cocoa-0 px-3 py-2 text-[15px] outline-none"
      />
      <p className="mt-1 text-[12px] text-oat/45">
        Esc para <button type="button" onClick={onDone} className="text-ember-2 hover:underline">cancelar</button> · Enter para{" "}
        <button type="button" onClick={() => void save()} className="text-ember-2 hover:underline">salvar</button>
      </p>
    </div>
  );
}

export function AttachmentView({ a, mine }: { a: Attachment; mine?: boolean }) {
  const [big, setBig] = useState(false);
  if (a.sticker) return <StickerView a={a} mine={!!mine} />;
  if (a.gif) return <GifView a={a} />;
  if (a.mime.startsWith("image/")) {
    const w = a.width ?? 400;
    const h = a.height ?? 300;
    const scale = Math.min(1, 420 / w, 320 / h);
    return (
      <>
        <button type="button" onClick={() => setBig(true)} className="block overflow-hidden rounded-[12px] bg-cocoa-2" style={{ width: Math.round(w * scale), maxWidth: "100%", aspectRatio: `${w} / ${h}` }}>
          <img src={a.url} alt={a.name} loading="lazy" className="size-full object-cover" />
        </button>
        {big && (
          <div className="fixed inset-0 z-50 grid place-items-center bg-cocoa-0/90 p-6" onClick={() => setBig(false)} role="dialog" aria-label={a.name}>
            <img src={a.url} alt={a.name} className="max-h-full max-w-full rounded-[10px] object-contain" />
            <a href={a.url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="absolute bottom-5 text-[13px] text-oat/60 hover:text-oat hover:underline">
              Abrir original
            </a>
          </div>
        )}
      </>
    );
  }
  if (a.mime.startsWith("video/")) return <video src={a.url} controls className="max-h-[320px] max-w-full rounded-[12px] bg-cocoa-0" preload="metadata" />;
  if (a.mime.startsWith("audio/"))
    return (
      <div className="w-[min(380px,100%)] rounded-[12px] bg-cocoa-2 p-3">
        <p className="mb-2 truncate text-[13.5px] font-semibold">{a.name}</p>
        <audio src={a.url} controls className="w-full" preload="none" />
      </div>
    );
  return (
    <a href={a.url} download={a.name} className="flex w-[min(380px,100%)] items-center gap-3 rounded-[12px] bg-cocoa-2 p-3 hover:bg-cocoa-4">
      <FileText className="size-8 shrink-0 text-ember" />
      <span className="min-w-0">
        <span className="block truncate text-[14px] font-semibold text-ember-2">{a.name}</span>
        <span className="text-[12px] text-oat/45">{sizeOf(a.size)}</span>
      </span>
    </a>
  );
}

/* ------------------------------------------------------------------ */
/* caixa de escrever                                                   */
/* ------------------------------------------------------------------ */

function AutoTextarea({
  value,
  onChange,
  className,
  ...rest
}: { value: string; onChange: (v: string) => void } & Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, "onChange" | "value">) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${Math.min(el.scrollHeight, 260)}px`;
  }, [value]);
  return <textarea ref={ref} rows={1} value={value} onChange={(e) => onChange(e.target.value)} className={`resize-none ${className}`} {...rest} />;
}

interface Pending {
  file: File;
  preview: string | null;
}

function Composer({ channelId, server, placeholder }: { channelId: string; server?: Server; placeholder: string }) {
  const [text, setText] = useState("");
  const [files, setFiles] = useState<Pending[]>([]);
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [busy, setBusy] = useState(false);
  const [mention, setMention] = useState<{ q: string; index: number } | null>(null);
  const picker = useAnchor<HTMLButtonElement>();
  const stickers = useAnchor<HTMLButtonElement>();
  const fileInput = useRef<HTMLInputElement>(null);
  const area = useRef<HTMLDivElement>(null);
  const typing = useStore((s) => s.typing[channelId]);
  const users = useStore((s) => s.users);
  useTicker(1000, !!typing && Object.keys(typing).length > 0);

  // rascunho por canal
  useEffect(() => {
    try {
      setText(sessionStorage.getItem(`cdg:draft:${channelId}`) ?? "");
    } catch {
      setText("");
    }
    setReplyTo(null);
    setFiles([]);
  }, [channelId]);
  useEffect(() => {
    try {
      if (text) sessionStorage.setItem(`cdg:draft:${channelId}`, text);
      else sessionStorage.removeItem(`cdg:draft:${channelId}`);
    } catch {
      /* sem armazenamento */
    }
  }, [text, channelId]);

  useEffect(() => {
    const onReply = (e: Event) => {
      const m = (e as CustomEvent<Message>).detail;
      if (m.channel_id !== channelId) return;
      setReplyTo(m);
      area.current?.querySelector("textarea")?.focus();
    };
    window.addEventListener("cdg:reply", onReply);
    return () => window.removeEventListener("cdg:reply", onReply);
  }, [channelId]);

  const addFiles = (list: FileList | File[]) => {
    const arr = Array.from(list).slice(0, 10 - files.length);
    for (const f of arr) {
      if (f.size > 25 * 1024 * 1024) {
        toast(`${f.name} passa de 25 MB.`);
        continue;
      }
      setFiles((cur) => [...cur, { file: f, preview: f.type.startsWith("image/") ? URL.createObjectURL(f) : null }]);
    }
  };

  async function sendSpecial(body: { sticker_id: string } | { gif: { url: string; width: number; height: number; title: string } }) {
    stickers.close();
    try {
      await api(`/channels/${channelId}/messages`, { json: { ...body, reply_to: replyTo?.id } });
      setReplyTo(null);
    } catch (e) {
      toast(errorText(e));
    }
  }

  async function send() {
    const content = text.trim();
    if ((!content && !files.length) || (busy && files.length)) return;
    const toSend = files;
    if (toSend.length) setBusy(true);
    const reply = replyTo;
    setText("");
    setReplyTo(null);
    setFiles([]);
    try {
      const ids: string[] = [];
      for (const p of toSend) {
        const up = await upload<{ id: string }>("/files", p.file);
        ids.push(up.id);
      }
      await sendMessage(channelId, content, { replyTo: reply, attachmentIds: ids });
    } catch (e) {
      toast(errorText(e));
      setText((t) => t || content);
      setFiles(toSend);
    } finally {
      if (toSend.length) setBusy(false);
    }
  }

  // autocompletar /comando (os da casa e os dos bots do servidor)
  const [cmdCache, setCmdCache] = useState<{ cid: string; list: { name: string; description: string; bot: string }[] } | null>(null);
  const commands = cmdCache?.cid === channelId ? cmdCache.list : null;
  const slash = /^\/([a-z0-9_-]*)$/i.exec(text)?.[1]?.toLowerCase();
  const wantCommands = slash !== undefined && commands === null;
  useEffect(() => {
    if (!wantCommands) return;
    let alive = true;
    api<{ name: string; description: string; bot: string }[]>(`/channels/${channelId}/commands`)
      .then((list) => alive && setCmdCache({ cid: channelId, list }))
      .catch(() => alive && setCmdCache({ cid: channelId, list: [] }));
    return () => {
      alive = false;
    };
  }, [wantCommands, channelId]);
  const cmdMatches = slash !== undefined && commands ? commands.filter((c) => c.name.startsWith(slash)).slice(0, 8) : [];
  const [cmdSel, setCmdSel] = useState(0);
  function completeCommand(name: string) {
    setText(`/${name} `);
    setCmdSel(0);
    area.current?.querySelector("textarea")?.focus();
  }

  // autocompletar @menção
  const members = useMemo(() => server?.members.map((m) => m.user) ?? [], [server]);
  const matches = mention
    ? members.filter((u) => u.username.startsWith(mention.q.toLowerCase()) || u.display_name.toLowerCase().startsWith(mention.q.toLowerCase())).slice(0, 6)
    : [];
  const [sel, setSel] = useState(0);

  function onText(v: string) {
    setText(v);
    if (v) sendTyping(channelId);
    const ta = area.current?.querySelector("textarea");
    const caret = ta?.selectionStart ?? v.length;
    const m = /(?:^|\s)@([a-z0-9_.]*)$/i.exec(v.slice(0, caret));
    setMention(m && server ? { q: m[1], index: caret - m[1].length - 1 } : null);
    setSel(0);
  }

  function complete(u: User) {
    if (!mention) return;
    const before = text.slice(0, mention.index);
    const after = text.slice(mention.index + 1 + mention.q.length);
    setText(`${before}@${u.username} ${after}`);
    setMention(null);
    area.current?.querySelector("textarea")?.focus();
  }

  const typers = Object.entries(typing ?? {})
    .filter(([, until]) => until > Date.now())
    .map(([id]) => users[id]?.display_name)
    .filter(Boolean) as string[];

  return (
    <div
      className="shrink-0 px-3 pb-3 sm:px-4"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
      }}
    >
      <div ref={area} className="relative rounded-[16px] bg-cocoa-4/70">
        {cmdMatches.length > 0 && (
          <div className="absolute inset-x-0 bottom-full mb-2 rounded-[14px] bg-cocoa-0 p-1.5" role="listbox" aria-label="Comandos">
            <p className="label px-2 pb-1.5 pt-1 text-oat/40">Comandos</p>
            {cmdMatches.map((c, i) => (
              <button
                key={c.name}
                type="button"
                role="option"
                aria-selected={i === cmdSel % cmdMatches.length}
                onMouseDown={(e) => {
                  e.preventDefault();
                  completeCommand(c.name);
                }}
                className={`flex w-full items-baseline gap-2.5 rounded-[9px] px-2 py-1.5 text-left text-[14px] ${i === cmdSel % cmdMatches.length ? "bg-cocoa-4" : ""}`}
              >
                <span className="font-semibold">/{c.name}</span>
                <span className="min-w-0 flex-1 truncate text-[12.5px] text-oat/50">{c.description}</span>
                <span className="shrink-0 text-[11px] text-oat/35">{c.bot}</span>
              </button>
            ))}
          </div>
        )}
        {mention && matches.length > 0 && (
          <div className="absolute inset-x-0 bottom-full mb-2 rounded-[14px] bg-cocoa-0 p-1.5">
            <p className="label px-2 pb-1.5 pt-1 text-oat/40">Membros</p>
            {matches.map((u, i) => (
              <button
                key={u.id}
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  complete(u);
                }}
                className={`flex w-full items-center gap-2.5 rounded-[9px] px-2 py-1.5 text-left text-[14px] ${i === sel ? "bg-cocoa-4" : ""}`}
              >
                <Avatar name={u.display_name} avatar={u.avatar} accent={u.accent} size={24} />
                <span className="font-semibold">{u.display_name}</span>
                <span className="text-oat/40">@{u.username}</span>
              </button>
            ))}
          </div>
        )}
        {replyTo && (
          <div className="flex items-center gap-2 rounded-t-[16px] border-b border-oat/[0.06] px-4 py-2 text-[13px] text-oat/60">
            <Reply className="size-3.5" />
            Respondendo a <strong className="text-oat">{replyTo.author?.display_name}</strong>
            <button type="button" onClick={() => setReplyTo(null)} aria-label="Cancelar resposta" className="ml-auto rounded-full p-0.5 hover:bg-cocoa-5">
              <X className="size-3.5" />
            </button>
          </div>
        )}
        {files.length > 0 && (
          <div className="flex gap-2 overflow-x-auto px-3 pt-3">
            {files.map((p, i) => (
              <div key={i} className="relative w-[120px] shrink-0 rounded-[12px] bg-cocoa-2 p-2">
                {p.preview ? <img src={p.preview} alt="" className="h-[84px] w-full rounded-[8px] object-cover" /> : <FileText className="mx-auto my-4 size-10 text-ember" />}
                <p className="mt-1.5 truncate text-[11.5px] text-oat/60">{p.file.name}</p>
                <button type="button" onClick={() => setFiles((f) => f.filter((_, j) => j !== i))} aria-label="Tirar anexo" className="absolute -right-1.5 -top-1.5 grid size-6 place-items-center rounded-full bg-rust text-oat">
                  <X className="size-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="flex items-end gap-1 px-2 py-1.5">
          <button type="button" onClick={() => fileInput.current?.click()} aria-label="Anexar arquivo" className="press mb-0.5 grid size-9 shrink-0 place-items-center rounded-full text-oat/55 hover:bg-cocoa-5 hover:text-oat">
            <Plus className="size-5" />
          </button>
          <input ref={fileInput} type="file" multiple hidden onChange={(e) => e.target.files && addFiles(e.target.files)} />
          <AutoTextarea
            value={text}
            onChange={onText}
            placeholder={placeholder}
            onPaste={(e) => {
              if (e.clipboardData.files.length) {
                e.preventDefault();
                addFiles(e.clipboardData.files);
              }
            }}
            onKeyDown={(e) => {
              if (cmdMatches.length) {
                const n = cmdMatches.length;
                if (e.key === "ArrowDown") return (e.preventDefault(), setCmdSel((s) => (s + 1) % n));
                if (e.key === "ArrowUp") return (e.preventDefault(), setCmdSel((s) => (s - 1 + n) % n));
                const exact = cmdMatches.some((c) => c.name === slash);
                if (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey && !exact)) return (e.preventDefault(), completeCommand(cmdMatches[cmdSel % n].name));
              }
              if (mention && matches.length) {
                if (e.key === "ArrowDown") return (e.preventDefault(), setSel((s) => (s + 1) % matches.length));
                if (e.key === "ArrowUp") return (e.preventDefault(), setSel((s) => (s - 1 + matches.length) % matches.length));
                if (e.key === "Enter" || e.key === "Tab") return (e.preventDefault(), complete(matches[sel]));
                if (e.key === "Escape") return setMention(null);
              }
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void send();
              }
              if (e.key === "Escape" && replyTo) setReplyTo(null);
            }}
            className="max-h-[260px] min-h-[38px] flex-1 bg-transparent py-2 text-[15px] leading-[1.4] outline-none placeholder:text-oat/30"
          />
          <button
            type="button"
            onClick={(e) => stickers.open(e.currentTarget)}
            aria-label="Figurinhas e GIFs"
            title="Figurinhas e GIFs"
            className="press mb-0.5 grid size-9 shrink-0 place-items-center rounded-full text-oat/55 hover:bg-cocoa-5 hover:text-oat"
          >
            <StickerIcon className="size-5" />
          </button>
          <button type="button" onClick={(e) => picker.open(e.currentTarget)} aria-label="Emoji" className="press mb-0.5 grid size-9 shrink-0 place-items-center rounded-full text-oat/55 hover:bg-cocoa-5 hover:text-oat">
            <SmilePlus className="size-5" />
          </button>
        </div>
      </div>
      <div className="h-5 px-2 pt-1 text-[12px] text-oat/55" aria-live="polite">
        {typers.length > 0 && (
          <span className="flex items-center gap-1.5">
            <span className="dots" aria-hidden>
              <span />
              <span />
              <span />
            </span>
            <strong className="font-semibold text-oat/80">{typers.slice(0, 3).join(", ")}</strong>
            {typers.length === 1 ? " está digitando…" : " estão digitando…"}
          </span>
        )}
      </div>
      <Popover anchor={stickers.rect} onClose={stickers.close} side="top">
        <StickerPicker
          onSticker={(s) => void sendSpecial({ sticker_id: s.id })}
          onGif={(g) => void sendSpecial({ gif: { url: g.url, width: g.width, height: g.height, title: g.title } })}
        />
      </Popover>
      <Popover anchor={picker.rect} onClose={picker.close} side="top">
        <EmojiPicker
          emojis={server?.emojis}
          onPick={(e) => {
            setText((t) => t + e);
            area.current?.querySelector("textarea")?.focus();
          }}
        />
      </Popover>
    </div>
  );
}
