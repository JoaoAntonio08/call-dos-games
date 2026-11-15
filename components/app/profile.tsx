"use client";

import { themeBgOf } from "@/lib/badges";
import { BadgeRow } from "./badges";
import { SteamCard } from "./integracoes";
import { useEffect, useState } from "react";
import { MessageCircle, Pencil, UserCheck, UserPlus } from "lucide-react";
import { api, errorText } from "@/lib/api";
import { useStore, usePresence } from "@/lib/store";
import { closeProfile, openModal, toast, useUI } from "@/lib/ui";
import { sinceOf } from "@/lib/format";
import type { Relation, User } from "@/lib/types";
import { AnimImg, Avatar, Popover, statusLabel } from "./bits";
import { useOpenDm } from "./friends";

type Full = User & { relation: Relation; mutual_servers: { id: string; name: string }[] };

/** Cartão de perfil: banner, foto (animada aqui sempre), frase, bio e ações. */
export function ProfilePopover() {
  const profile = useUI((s) => s.profile);
  const me = useStore((s) => s.me);
  const cached = useStore((s) => (profile ? s.users[profile.id] : undefined));
  const status = usePresence(profile?.id);
  const servers = useStore((s) => s.servers);
  const [full, setFull] = useState<Full | null>(null);
  const openDm = useOpenDm();

  useEffect(() => {
    setFull(null);
    if (!profile) return;
    let alive = true;
    api<Full>(`/users/${profile.id}`)
      .then((u) => alive && setFull(u))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [profile]);

  if (!profile) return null;
  const isMe = profile.id === me?.id;
  const u: User | undefined = isMe ? me! : (cached ?? full ?? undefined);
  if (!u) return null;
  const member = profile.serverId ? servers[profile.serverId]?.members.find((m) => m.user.id === u.id) : undefined;
  const relation = isMe ? "self" : full?.relation;
  const accent = u.accent || "#5865f2";
  const themeBg = themeBgOf(u);

  async function addFriend() {
    try {
      const r = await api<{ relation: Relation }>("/friends", { json: { username: u!.username } });
      setFull((f) => (f ? { ...f, relation: r.relation } : f));
      toast(r.relation === "friends" ? "Agora vocês são amigos." : "Pedido de amizade enviado.");
    } catch (e) {
      toast(errorText(e));
    }
  }

  return (
    <Popover anchor={profile.rect} onClose={closeProfile} side="right" className="w-[320px]">
      <div className="overflow-hidden rounded-[18px] bg-cocoa-0" style={{ ["--dot-ring" as string]: themeBg ? (u.theme[0] ?? "var(--color-cocoa-0)") : "var(--color-cocoa-0)", background: themeBg }}>
        {/* banner: imagem ou faixa na cor do perfil */}
        <div className="relative h-[112px]" style={{ background: themeBg ? "transparent" : `color-mix(in srgb, ${accent} 65%, #18191c)` }}>
          {u.banner && <AnimImg media={u.banner} alt="" className="size-full object-cover" play />}
        </div>
        <div className="relative px-4 pb-4">
          <div className="-mt-11 flex items-end justify-between">
            <span className="rounded-full p-1.5" style={{ background: themeBg ? u.theme[0] : "var(--color-cocoa-0)" }}>
              <Avatar name={u.display_name} avatar={u.avatar} accent={accent} size={80} status={status} play />
            </span>
            {member && member.role !== "member" && (
              <span className="mb-2 rounded-full bg-cocoa-3 px-2.5 py-1 text-[11.5px] font-semibold text-oat/70">{member.role === "owner" ? "Dono do servidor" : "Admin"}</span>
            )}
          </div>
          <BadgeRow user={u} className="mt-2" />
          <div className={`mt-2 rounded-[14px] p-3.5 ${themeBg ? "bg-black/40 backdrop-blur-sm" : "bg-cocoa-2"}`}>
            <p className="font-display text-[24px] font-semibold leading-tight" style={{ color: u.name_color || undefined }}>
              {member?.nickname || u.display_name}
            </p>
            <p className="text-[13.5px] text-oat/55">
              @{u.username}
              {u.pronouns && <span> · {u.pronouns}</span>}
            </p>
            {(u.custom_status || status !== "offline") && (
              <p className="mt-2 text-[13.5px] text-oat/80">
                {u.custom_status || statusLabel(status)}
              </p>
            )}
            {u.bio && (
              <>
                <div className="my-3 h-px bg-oat/[0.08]" />
                <p className="label mb-1.5 text-oat/40">Sobre</p>
                <p className="whitespace-pre-wrap text-[13.5px] leading-relaxed text-oat/85">{u.bio}</p>
              </>
            )}
            <div className="my-3 h-px bg-oat/[0.08]" />
            <p className="label mb-1 text-oat/40">Na turma desde</p>
            <p className="text-[13.5px] text-oat/80">{sinceOf(u.created_at)}</p>
            <SteamCard userId={u.id} />
            {full && full.mutual_servers.length > 0 && !isMe && (
              <p className="mt-2 text-[12.5px] text-oat/50">
                {full.mutual_servers.length === 1 ? "Servidor em comum: " : `${full.mutual_servers.length} servidores em comum: `}
                {full.mutual_servers.map((s) => s.name).join(", ")}
              </p>
            )}
          </div>

          <div className="mt-3 flex gap-2">
            {isMe ? (
              <button type="button" onClick={() => openModal({ kind: "settings", tab: "perfil" })} className="btn-quiet flex h-10 flex-1 items-center justify-center gap-2 text-[14px]">
                <Pencil className="size-4" /> Editar perfil
              </button>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => {
                    closeProfile();
                    void openDm(u.id);
                  }}
                  className="btn-ember flex h-10 flex-1 items-center justify-center gap-2 text-[14px]"
                >
                  <MessageCircle className="size-4" /> Mensagem
                </button>
                {relation === "none" || relation === "incoming" ? (
                  <button type="button" onClick={() => void addFriend()} title={relation === "incoming" ? "Aceitar pedido" : "Adicionar amigo"} className="btn-quiet grid h-10 w-11 place-items-center">
                    <UserPlus className="size-4" />
                  </button>
                ) : relation === "friends" ? (
                  <span title="Vocês são amigos" className="grid h-10 w-11 place-items-center rounded-[12px] bg-moss/15 text-moss">
                    <UserCheck className="size-4" />
                  </span>
                ) : relation === "outgoing" ? (
                  <span className="grid h-10 place-items-center rounded-[12px] bg-cocoa-3 px-3 text-[12px] text-oat/55">Pedido enviado</span>
                ) : null}
              </>
            )}
          </div>
        </div>
      </div>
    </Popover>
  );
}
