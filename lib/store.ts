"use client";

import { create } from "zustand";
import { api, ApiError, GATEWAY_URL, getToken, setToken } from "./api";
import type { Bootstrap, Dm, Friend, HallEntry, Me, Message, Presence, QueueItem, Server, Show, User, VoiceMember } from "./types";

interface ChannelMessages {
  items: Message[];
  loaded: boolean;
  loading: boolean;
  hasMore: boolean;
}

interface State {
  phase: "boot" | "anon" | "ready";
  connected: boolean;
  livekit: boolean;
  livekitCloud: boolean;
  me: Me | null;
  servers: Record<string, Server>;
  serverOrder: string[];
  dms: Dm[];
  friends: Friend[];
  users: Record<string, User>;
  presence: Record<string, { status: Presence; custom_status: string }>;
  messages: Record<string, ChannelMessages>;
  reads: Record<string, string>;
  voice: Record<string, VoiceMember[]>;
  typing: Record<string, Record<string, number>>;
  /** por servidor; undefined = ainda não carregou */
  hall: Record<string, { items: HallEntry[]; hasMore: boolean } | undefined>;
  shows: Record<string, Show[] | undefined>;
  /** por canal de voz/conversa */
  queue: Record<string, QueueItem[] | undefined>;
}

const EMPTY: ChannelMessages = { items: [], loaded: false, loading: false, hasMore: true };

export const useStore = create<State>(() => ({
  phase: "boot",
  connected: false,
  livekit: false,
  livekitCloud: false,
  me: null,
  servers: {},
  serverOrder: [],
  dms: [],
  friends: [],
  users: {},
  presence: {},
  messages: {},
  reads: {},
  voice: {},
  typing: {},
  hall: {},
  shows: {},
  queue: {},
}));

const set = useStore.setState;
const get = useStore.getState;

/* ------------------------------------------------------------------ */
/* utilidades                                                          */
/* ------------------------------------------------------------------ */

/** Compara ids (snowflakes em texto). */
export function idGt(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a) return false;
  if (!b) return true;
  // mensagem ainda sendo enviada tem id provisório ("tmp-…"): conta como a mais nova
  const ta = !/^\d+$/.test(a);
  const tb = !/^\d+$/.test(b);
  if (ta || tb) return ta && !tb;
  return BigInt(a) > BigInt(b);
}

function rememberUsers(list: (User | null | undefined)[], into: Record<string, User> = { ...get().users }) {
  for (const u of list) if (u) into[u.id] = u;
  return into;
}

/** Usuário com a presença mais recente. */
export function useUser(id: string | null | undefined): User | null {
  return useStore((s) => {
    if (!id) return null;
    const u = s.users[id] ?? (s.me?.id === id ? s.me : null);
    return u;
  });
}

export function usePresence(id: string | null | undefined): Presence {
  return useStore((s) => {
    if (!id) return "offline";
    if (s.me?.id === id) return s.me.status === "invisible" ? "invisible" : s.me.status;
    return s.presence[id]?.status ?? s.users[id]?.status ?? "offline";
  });
}

export function channelMessages(cid: string): ChannelMessages {
  return get().messages[cid] ?? EMPTY;
}

function patchMessages(cid: string, fn: (m: ChannelMessages) => ChannelMessages) {
  set((s) => ({ messages: { ...s.messages, [cid]: fn(s.messages[cid] ?? EMPTY) } }));
}

function touchChannel(cid: string, mid: string) {
  set((s) => {
    const servers = { ...s.servers };
    for (const sv of Object.values(servers)) {
      const i = sv.channels.findIndex((c) => c.id === cid);
      if (i >= 0) {
        const channels = [...sv.channels];
        channels[i] = { ...channels[i], last_message_id: mid };
        servers[sv.id] = { ...sv, channels };
        return { servers };
      }
    }
    const dms = s.dms.map((d) => (d.id === cid ? { ...d, last_message_id: mid } : d));
    dms.sort((a, b) => (idGt(a.last_message_id ?? a.id, b.last_message_id ?? b.id) ? -1 : 1));
    return { dms };
  });
}

/* ------------------------------------------------------------------ */
/* carga inicial                                                       */
/* ------------------------------------------------------------------ */

export async function bootstrap() {
  if (!getToken()) {
    set({ phase: "anon" });
    return;
  }
  try {
    const b = await api<Bootstrap>("/bootstrap");
    const users = rememberUsers(
      [b.me, ...b.servers.flatMap((s) => s.members.map((m) => m.user)), ...b.dms.flatMap((d) => d.recipients), ...b.friends.map((f) => f.user)],
      {},
    );
    const presence: State["presence"] = {};
    for (const u of Object.values(users)) presence[u.id] = { status: u.status, custom_status: u.custom_status };
    set({
      phase: "ready",
      me: b.me,
      livekit: b.livekit,
      livekitCloud: b.livekit_cloud,
      servers: Object.fromEntries(b.servers.map((s) => [s.id, s])),
      serverOrder: b.servers.map((s) => s.id),
      dms: b.dms,
      friends: b.friends,
      users,
      presence,
      reads: b.read_states,
      voice: b.voice,
    });
    gateway.connect();
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) {
      setToken(null);
      set({ phase: "anon" });
    } else {
      // servidor fora do ar: tenta de novo daqui a pouco
      window.setTimeout(bootstrap, 4000);
    }
  }
}

export async function logout() {
  try {
    await api("/auth/logout", { method: "POST" });
  } catch {
    /* já saiu */
  }
  setToken(null);
  gateway.close();
  set({ phase: "anon", me: null, servers: {}, serverOrder: [], dms: [], friends: [], messages: {}, voice: {}, hall: {}, shows: {}, queue: {} });
}

/* ------------------------------------------------------------------ */
/* mensagens                                                           */
/* ------------------------------------------------------------------ */

export async function loadMessages(cid: string, older = false) {
  const cur = channelMessages(cid);
  if (cur.loading || (older && !cur.hasMore) || (!older && cur.loaded)) return;
  patchMessages(cid, (m) => ({ ...m, loading: true }));
  try {
    const before = older && cur.items[0] ? `&before=${cur.items[0].id}` : "";
    const got = await api<Message[]>(`/channels/${cid}/messages?limit=50${before}`);
    set((s) => ({ users: rememberUsers(got.map((m) => m.author), { ...s.users }) }));
    patchMessages(cid, (m) => {
      const known = new Set(m.items.map((x) => x.id));
      const fresh = got.filter((x) => !known.has(x.id));
      return { items: older ? [...fresh, ...m.items] : [...m.items, ...fresh], loaded: true, loading: false, hasMore: got.length === 50 };
    });
  } catch {
    patchMessages(cid, (m) => ({ ...m, loading: false }));
  }
}

let tempN = 0;
export async function sendMessage(cid: string, content: string, opts: { replyTo?: Message | null; attachmentIds?: string[] } = {}) {
  const me = get().me!;
  const nonce = `tmp-${Date.now()}-${tempN++}`;
  const temp: Message = {
    id: nonce,
    channel_id: cid,
    author: me,
    content,
    kind: "default",
    attachments: [],
    reply_to: opts.replyTo
      ? { id: opts.replyTo.id, author_id: opts.replyTo.author?.id ?? null, author_name: opts.replyTo.author?.display_name ?? "", content: opts.replyTo.content.slice(0, 140), has_attachments: opts.replyTo.attachments.length > 0 }
      : null,
    reply_missing: false,
    reactions: [],
    edited_at: null,
    created_at: new Date().toISOString(),
    pending: true,
    nonce,
  };
  if (!opts.attachmentIds?.length) patchMessages(cid, (m) => ({ ...m, items: [...m.items, temp] }));
  try {
    const real = await api<Message>(`/channels/${cid}/messages`, {
      json: { content, reply_to: opts.replyTo?.id ?? null, attachment_ids: opts.attachmentIds ?? [] },
    });
    patchMessages(cid, (m) => {
      const items = m.items.filter((x) => x.id !== nonce);
      return { ...m, items: items.some((x) => x.id === real.id) ? items : [...items, real] };
    });
    markRead(cid, real.id);
  } catch (e) {
    patchMessages(cid, (m) => ({ ...m, items: m.items.filter((x) => x.id !== nonce) }));
    throw e;
  }
}

const readTimer: Record<string, number> = {};
export function markRead(cid: string, mid: string | null | undefined) {
  if (!mid || mid.startsWith("tmp")) return;
  const cur = get().reads[cid];
  if (cur && !idGt(mid, cur)) return;
  set((s) => ({ reads: { ...s.reads, [cid]: mid } }));
  window.clearTimeout(readTimer[cid]);
  readTimer[cid] = window.setTimeout(() => {
    void api(`/channels/${cid}/read`, { json: { message_id: mid } }).catch(() => {});
  }, 800);
}

export function isUnread(cid: string, lastMessageId: string | null, reads: Record<string, string>): boolean {
  return !!lastMessageId && idGt(lastMessageId, reads[cid]);
}

/* ------------------------------------------------------------------ */
/* gateway (WebSocket)                                                 */
/* ------------------------------------------------------------------ */

type Listener = () => void;

class Gateway {
  ws: WebSocket | null = null;
  retry = 0;
  timer = 0;
  pinger = 0;
  closed = false;
  helloListeners = new Set<Listener>();

  connect() {
    this.closed = false;
    if (this.ws && this.ws.readyState <= 1) return;
    const token = getToken();
    if (!token) return;
    const ws = new WebSocket(GATEWAY_URL);
    this.ws = ws;
    ws.onopen = () => ws.send(JSON.stringify({ op: "auth", token }));
    ws.onmessage = (ev) => {
      try {
        const { t, d } = JSON.parse(ev.data as string);
        if (t === "hello") {
          this.retry = 0;
          const first = !get().connected;
          set({ connected: true, ...(d?.voice ? { voice: d.voice } : {}) });
          window.clearInterval(this.pinger);
          this.pinger = window.setInterval(() => this.send({ op: "ping" }), 30_000);
          // depois de cair, recarrega tudo para não perder nada que aconteceu offline
          if (first && this.everConnected) void refreshAfterReconnect();
          // o que chegou entre carregar as mensagens e o gateway conectar teria se perdido
          if (first) void resyncMessages();
          this.everConnected = true;
          this.helloListeners.forEach((f) => f());
        } else handleEvent(t, d);
      } catch {
        /* evento malformado */
      }
    };
    ws.onclose = (ev) => {
      window.clearInterval(this.pinger);
      set({ connected: false });
      this.ws = null;
      if (this.closed) return;
      if (ev.code === 4001) {
        setToken(null);
        set({ phase: "anon" });
        return;
      }
      const wait = Math.min(15_000, 800 * 2 ** this.retry++);
      this.timer = window.setTimeout(() => this.connect(), wait);
    };
  }

  everConnected = false;

  send(msg: unknown) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  onHello(f: Listener) {
    this.helloListeners.add(f);
    return () => {
      this.helloListeners.delete(f);
    };
  }

  close() {
    this.closed = true;
    this.everConnected = false;
    window.clearTimeout(this.timer);
    window.clearInterval(this.pinger);
    this.ws?.close();
    this.ws = null;
  }
}

export const gateway = new Gateway();

async function refreshAfterReconnect() {
  try {
    const b = await api<Bootstrap>("/bootstrap");
    set((s) => ({
      me: b.me,
      servers: Object.fromEntries(b.servers.map((x) => [x.id, x])),
      serverOrder: b.servers.map((x) => x.id),
      dms: b.dms,
      friends: b.friends,
      voice: b.voice,
      reads: { ...b.read_states, ...s.reads },
      users: rememberUsers([b.me, ...b.servers.flatMap((x) => x.members.map((m) => m.user)), ...b.friends.map((f) => f.user)], { ...s.users }),
    }));
  } catch {
    /* tenta na próxima */
  }
}

async function resyncMessages() {
  const loaded = Object.entries(get().messages).filter(([, m]) => m.loaded);
  await Promise.all(
    loaded.map(async ([cid]) => {
      try {
        const got = await api<Message[]>(`/channels/${cid}/messages?limit=50`);
        set((s) => ({ users: rememberUsers(got.map((m) => m.author), { ...s.users }) }));
        patchMessages(cid, (m) => {
          const oldest = got[0]?.id;
          const fresh = new Map(got.map((x) => [x.id, x]));
          // mantém as antigas e as que ainda estão sendo enviadas; o trecho recente vem do servidor
          const keep = m.items.filter((x) => x.id.startsWith("tmp-") || (oldest && idGt(oldest, x.id) && !fresh.has(x.id)));
          const older = keep.filter((x) => !x.id.startsWith("tmp-"));
          const pending = keep.filter((x) => x.id.startsWith("tmp-"));
          return { ...m, items: [...older, ...got, ...pending] };
        });
      } catch {
        /* fica com o que tem */
      }
    }),
  );
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function handleEvent(t: string, d: any) {
  switch (t) {
    case "presence":
      set((s) => ({ presence: { ...s.presence, [d.user_id]: { status: d.status, custom_status: d.custom_status } } }));
      break;
    case "user_update":
      set((s) => ({
        users: { ...s.users, [d.id]: d },
        me: s.me && s.me.id === d.id ? { ...s.me, ...d, status: s.me.status } : s.me,
      }));
      break;
    case "relation":
      set((s) => {
        const others = s.friends.filter((f) => f.user.id !== d.user.id);
        return {
          friends: d.relation === "none" ? others : [...others, { user: d.user, relation: d.relation }],
          users: { ...s.users, [d.user.id]: d.user },
        };
      });
      break;
    case "dm_create":
      set((s) => ({
        dms: s.dms.some((x) => x.id === d.id) ? s.dms : [d, ...s.dms],
        users: rememberUsers(d.recipients, { ...s.users }),
      }));
      break;
    case "server_create":
    case "server_update":
      set((s) => ({
        servers: { ...s.servers, [d.id]: d },
        serverOrder: s.serverOrder.includes(d.id) ? s.serverOrder : [...s.serverOrder, d.id],
        users: rememberUsers(
          d.members.map((m: { user: User }) => m.user),
          { ...s.users },
        ),
        presence: {
          ...s.presence,
          ...Object.fromEntries(d.members.map((m: { user: User }) => [m.user.id, { status: m.user.status, custom_status: m.user.custom_status }])),
        },
      }));
      break;
    case "server_delete":
      set((s) => {
        const servers = { ...s.servers };
        delete servers[d.id];
        return { servers, serverOrder: s.serverOrder.filter((x) => x !== d.id) };
      });
      break;
    case "message_create": {
      const m = d as Message;
      if (m.author) set((s) => ({ users: { ...s.users, [m.author!.id]: m.author! } }));
      patchMessages(m.channel_id, (cur) => (!cur.loaded || cur.items.some((x) => x.id === m.id) ? cur : { ...cur, items: [...cur.items, m] }));
      touchChannel(m.channel_id, m.id);
      if (m.author) {
        set((s) => {
          const ch = { ...(s.typing[m.channel_id] ?? {}) };
          delete ch[m.author!.id];
          return { typing: { ...s.typing, [m.channel_id]: ch } };
        });
      }
      if (m.author?.id === get().me?.id) markRead(m.channel_id, m.id);
      window.dispatchEvent(new CustomEvent("cdg:message", { detail: m }));
      break;
    }
    case "message_update":
      patchMessages(d.channel_id, (cur) => ({ ...cur, items: cur.items.map((x) => (x.id === d.id ? d : x)) }));
      break;
    case "message_delete":
      patchMessages(d.channel_id, (cur) => ({ ...cur, items: cur.items.filter((x) => x.id !== d.id) }));
      break;
    case "reactions": {
      const me = get().me?.id;
      const reactions = (d.reactions as { emoji: string; users: string[] }[]).map((r) => ({
        emoji: r.emoji,
        count: r.users.length,
        me: !!me && r.users.includes(me),
      }));
      patchMessages(d.channel_id, (cur) => ({ ...cur, items: cur.items.map((x) => (x.id === d.message_id ? { ...x, reactions } : x)) }));
      // a mesma mensagem pode estar no Hall da Fama
      set((s) => {
        let changed = false;
        const hall = { ...s.hall };
        for (const [k, v] of Object.entries(hall)) {
          if (v?.items.some((e) => e.message.id === d.message_id)) {
            changed = true;
            hall[k] = { ...v, items: v.items.map((e) => (e.message.id === d.message_id ? { ...e, message: { ...e.message, reactions } } : e)) };
          }
        }
        return changed ? { hall } : {};
      });
      break;
    }
    case "hall_add":
      set((s) => {
        const cur = s.hall[d.server_id];
        if (!cur || cur.items.some((e) => e.message.id === d.entry.message.id)) return {};
        return { hall: { ...s.hall, [d.server_id]: { ...cur, items: [d.entry, ...cur.items] } } };
      });
      break;
    case "hall_remove":
      set((s) => {
        const cur = s.hall[d.server_id];
        return cur ? { hall: { ...s.hall, [d.server_id]: { ...cur, items: cur.items.filter((e) => e.message.id !== d.message_id) } } } : {};
      });
      break;
    case "queue":
      set((s) => ({ queue: { ...s.queue, [d.channel_id]: d.items } }));
      break;
    case "shows":
      set((s) => ({ shows: { ...s.shows, [d.server_id]: d.items } }));
      break;
    case "typing":
      if (d.user_id === get().me?.id) break;
      set((s) => ({ typing: { ...s.typing, [d.channel_id]: { ...(s.typing[d.channel_id] ?? {}), [d.user_id]: Date.now() + 8000 } } }));
      break;
    case "voice_state":
      set((s) => ({ voice: { ...s.voice, [d.channel_id]: d.members } }));
      window.dispatchEvent(new CustomEvent("cdg:voice", { detail: d }));
      break;
  }
}

/* ------------------------------------------------------------------ */
/* Hall da Fama, fila e lista                                           */
/* ------------------------------------------------------------------ */

export async function loadHall(serverId: string, more = false) {
  const cur = get().hall[serverId];
  if (more && (!cur || !cur.hasMore)) return;
  const last = more ? cur?.items.at(-1)?.message.id : undefined;
  const items = await api<HallEntry[]>(`/servers/${serverId}/hall${last ? `?before=${last}` : ""}`);
  set((s) => ({
    hall: { ...s.hall, [serverId]: { items: more ? [...(s.hall[serverId]?.items ?? []), ...items] : items, hasMore: items.length >= 30 } },
  }));
}

export async function loadShows(serverId: string) {
  const items = await api<Show[]>(`/servers/${serverId}/shows`);
  set((s) => ({ shows: { ...s.shows, [serverId]: items } }));
}

export async function loadQueue(channelId: string) {
  const items = await api<QueueItem[]>(`/channels/${channelId}/queue`);
  set((s) => ({ queue: { ...s.queue, [channelId]: items } }));
}

/** As respostas dessas rotas já trazem a lista nova: aplica sem esperar o evento. */
export const setQueue = (channelId: string, items: QueueItem[]) => set((s) => ({ queue: { ...s.queue, [channelId]: items } }));
export const setShows = (serverId: string, items: Show[]) => set((s) => ({ shows: { ...s.shows, [serverId]: items } }));

let lastTyping = 0;
export function sendTyping(cid: string) {
  if (Date.now() - lastTyping < 5000) return;
  lastTyping = Date.now();
  gateway.send({ op: "typing", channel_id: cid });
}

// só em desenvolvimento: deixa o estado à mão para depurar e para os testes automáticos
if (typeof window !== "undefined" && process.env.NODE_ENV !== "production") {
  (window as unknown as { __cdg: typeof useStore }).__cdg = useStore;
}
