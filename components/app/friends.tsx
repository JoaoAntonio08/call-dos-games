"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Hash, MessageCircle, UserPlus, X } from "lucide-react";
import { api, errorText } from "@/lib/api";
import { useStore, usePresence } from "@/lib/store";
import { openProfile, toast, useUI } from "@/lib/ui";
import type { Dm, Friend } from "@/lib/types";
import { Avatar, FormError, statusLabel } from "./bits";

type Tab = "online" | "all" | "pending" | "add";

export function FriendsView() {
  const friends = useStore((s) => s.friends);
  const presence = useStore((s) => s.presence);
  const me = useStore((s) => s.me)!;
  const pending = friends.filter((f) => f.relation !== "friends");
  const accepted = friends.filter((f) => f.relation === "friends");
  const online = accepted.filter((f) => (presence[f.user.id]?.status ?? f.user.status) !== "offline");
  const [tab, setTab] = useState<Tab>(accepted.length ? "online" : "add");
  const list = tab === "online" ? online : tab === "all" ? accepted : pending;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex h-12 shrink-0 items-center gap-1 overflow-x-auto border-b border-cocoa-0/50 px-3 sm:px-4">
        <button type="button" onClick={() => useUI.setState({ navOpen: true })} className="press -ml-1 mr-1 rounded-md p-1.5 text-oat/60 md:hidden" aria-label="Abrir menu">
          <Hash className="size-5" />
        </button>
        <span className="mr-3 font-display text-[18px] font-semibold">Amigos</span>
        {(
          [
            ["online", "Online"],
            ["all", "Todos"],
            ["pending", `Pendentes${pending.length ? ` (${pending.length})` : ""}`],
          ] as [Tab, string][]
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`press shrink-0 rounded-[9px] px-2.5 py-1 text-[14px] font-semibold ${tab === id ? "bg-cocoa-5 text-oat" : "text-oat/55 hover:bg-cocoa-4 hover:text-oat"}`}
          >
            {label}
          </button>
        ))}
        <button
          type="button"
          onClick={() => setTab("add")}
          className={`press ml-1 shrink-0 rounded-[9px] px-2.5 py-1 text-[14px] font-semibold ${tab === "add" ? "text-ember-2" : "bg-ember text-white hover:bg-ember-2"}`}
        >
          Adicionar amigo
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-8">
        {tab === "add" ? (
          <AddFriend myUsername={me.username} />
        ) : list.length === 0 ? (
          <Empty tab={tab} onAdd={() => setTab("add")} />
        ) : (
          <>
            <p className="label mb-3 text-oat/40">
              {tab === "online" ? "Online" : tab === "all" ? "Todos os amigos" : "Pedidos"} — {list.length}
            </p>
            <ul className="divide-y divide-oat/[0.06]">
              {list.map((f) => (
                <FriendRow key={f.user.id} f={f} />
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}

function Empty({ tab, onAdd }: { tab: Tab; onAdd: () => void }) {
  const text = {
    online: ["Ninguém acordado por enquanto.", "Quando a turma ficar online, aparece aqui."],
    all: ["Ainda sem amigos por aqui.", "Adicione a turma pelo @ de cada um."],
    pending: ["Nenhum pedido esperando.", "Pedidos que você manda e recebe ficam aqui."],
    add: ["", ""],
  }[tab];
  return (
    <div className="mx-auto mt-16 max-w-sm text-center">
      <p className="font-display-wonk text-[30px] leading-tight">{text[0]}</p>
      <p className="mt-2 text-[14px] text-oat/50">{text[1]}</p>
      {tab !== "pending" && (
        <button type="button" onClick={onAdd} className="btn-ember mt-6 h-10 px-5 text-[14px]">
          Adicionar amigo
        </button>
      )}
    </div>
  );
}

export function useOpenDm() {
  const router = useRouter();
  return async (userId: string) => {
    try {
      const dm = await api<Dm>("/dms", { json: { user_id: userId } });
      useStore.setState((s) => ({ dms: s.dms.some((d) => d.id === dm.id) ? s.dms : [dm, ...s.dms] }));
      router.push(`/app/dm/${dm.id}`);
    } catch (e) {
      toast(errorText(e));
    }
  };
}

function FriendRow({ f }: { f: Friend }) {
  const status = usePresence(f.user.id);
  const user = useStore((s) => s.users[f.user.id]) ?? f.user;
  const openDm = useOpenDm();
  const act = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
    } catch (e) {
      toast(errorText(e));
    }
  };
  return (
    <li className="group flex items-center gap-3 py-2.5" style={{ ["--dot-ring" as string]: "var(--color-cocoa-3)" }}>
      <button type="button" onClick={(e) => openProfile(user.id, e.currentTarget)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
        <Avatar name={user.display_name} avatar={user.avatar} accent={user.accent} size={40} status={status} />
        <span className="min-w-0">
          <span className="block truncate font-semibold">
            {user.display_name} <span className="font-normal text-oat/40">@{user.username}</span>
          </span>
          <span className="block truncate text-[13px] text-oat/50">
            {f.relation === "incoming" ? "Quer ser seu amigo" : f.relation === "outgoing" ? "Pedido enviado" : user.custom_status || statusLabel(status)}
          </span>
        </span>
      </button>
      {f.relation === "friends" && (
        <RowButton label="Mensagem" onClick={() => void openDm(user.id)}>
          <MessageCircle />
        </RowButton>
      )}
      {f.relation === "incoming" && (
        <RowButton label="Aceitar" good onClick={() => void act(() => api(`/friends/${user.id}/accept`, { method: "POST" }))}>
          <Check />
        </RowButton>
      )}
      {f.relation !== "friends" && (
        <RowButton label={f.relation === "incoming" ? "Recusar" : "Cancelar pedido"} bad onClick={() => void act(() => api(`/friends/${user.id}`, { method: "DELETE" }))}>
          <X />
        </RowButton>
      )}
    </li>
  );
}

function RowButton({ label, onClick, good, bad, children }: { label: string; onClick: () => void; good?: boolean; bad?: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className={`press grid size-9 place-items-center rounded-full bg-cocoa-2 [&_svg]:size-[18px] ${
        good ? "text-moss hover:bg-moss hover:text-cocoa-0" : bad ? "text-oat/60 hover:bg-rust hover:text-oat" : "text-oat/70 hover:bg-cocoa-5 hover:text-oat"
      }`}
    >
      {children}
    </button>
  );
}

function AddFriend({ myUsername }: { myUsername: string }) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");
  return (
    <div className="max-w-2xl">
      <h2 className="font-display text-[30px] leading-tight">Chamar alguém pra turma</h2>
      <p className="mt-1 text-[14.5px] text-oat/55">
        Digite o @ da pessoa. O seu é <strong className="text-oat">@{myUsername}</strong>, mande para quem quiser te adicionar.
      </p>
      <form
        className="mt-5 flex gap-2"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!name.trim()) return;
          setBusy(true);
          setError("");
          setDone("");
          try {
            const r = await api<{ relation: string }>("/friends", { json: { username: name } });
            setDone(r.relation === "friends" ? `Pronto, vocês agora são amigos.` : `Pedido enviado para @${name.replace(/^@/, "")}.`);
            setName("");
          } catch (err) {
            setError(errorText(err));
          }
          setBusy(false);
        }}
      >
        <div className="relative flex-1">
          <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-oat/35">@</span>
          <input value={name} onChange={(e) => setName(e.target.value.toLowerCase().replace(/\s/g, ""))} placeholder="usuario" className="field h-12 pl-7" autoFocus />
        </div>
        <button type="submit" disabled={busy || !name.trim()} className="btn-ember flex h-12 items-center gap-2 px-5 text-[14.5px]">
          <UserPlus className="size-4" /> Mandar pedido
        </button>
      </form>
      <FormError>{error}</FormError>
      {done && <p className="mt-3 rounded-[10px] bg-moss/15 px-3 py-2 text-[13.5px] text-moss">{done}</p>}
    </div>
  );
}
