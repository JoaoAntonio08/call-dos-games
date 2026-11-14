"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Trophy, X } from "lucide-react";
import { api, errorText } from "@/lib/api";
import { loadHall, useStore, useUser } from "@/lib/store";
import { openProfile, toast, useUI } from "@/lib/ui";
import { agoOf, sinceOf } from "@/lib/format";
import type { HallEntry, Server } from "@/lib/types";
import { Avatar } from "./bits";
import { AttachmentView, ReactionGlyph } from "./chat";
import { RichText } from "./rich-text";

/* ------------------------------------------------------------------ */
/* Hall da Fama: o que a turma mais reagiu, guardado para sempre        */
/* ------------------------------------------------------------------ */

export function HallView({ server }: { server: Server }) {
  const hall = useStore((s) => s.hall[server.id]);
  const me = useStore((s) => s.me);
  const [busy, setBusy] = useState(false);
  const admin = server.members.find((m) => m.user.id === me?.id)?.role !== "member";

  useEffect(() => {
    void loadHall(server.id).catch((e) => toast(errorText(e)));
  }, [server.id]);

  async function more() {
    setBusy(true);
    try {
      await loadHall(server.id, true);
    } catch (e) {
      toast(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  const items = hall?.items ?? [];
  const textChannel = server.channels.find((c) => c.type === "text");

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex h-12 shrink-0 items-center gap-2.5 border-b border-cocoa-0/50 px-3 sm:px-4">
        <button type="button" onClick={() => useUI.setState({ navOpen: true })} className="press -ml-1 rounded-md p-1.5 text-oat/60 md:hidden" aria-label="Abrir menu">
          <Trophy className="size-5" />
        </button>
        <Trophy className="hidden size-5 text-ember-2 md:block" />
        <h1 className="font-semibold">Hall da Fama</h1>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[1100px] px-4 pb-16 pt-8 sm:px-8">
          <div className="max-w-[560px]">
            <p className="label text-ember-2">{server.name}</p>
            <h2 className="mt-2 font-display text-[clamp(34px,5vw,52px)] leading-[0.95]">Os clássicos da turma</h2>
            <p className="mt-3 text-[15px] leading-relaxed text-oat/55">
              Quando {server.hall_threshold === 1 ? "alguém reage" : `${server.hall_threshold} pessoas reagem`} a uma mensagem, ela entra aqui sozinha e não se perde mais no meio do
              chat.{admin && " Dá para mudar esse número nas configurações do servidor."}
            </p>
          </div>

          {!hall ? (
            <p className="mt-12 text-[14px] text-oat/40">Abrindo a vitrine…</p>
          ) : items.length === 0 ? (
            <div className="mt-12 border-l-2 border-ember/50 pl-5">
              <p className="font-display text-[22px]">Ainda vazio.</p>
              <p className="mt-1 max-w-[440px] text-[14.5px] text-oat/50">
                A primeira mensagem que fizer {server.hall_threshold} pessoas reagirem estreia o Hall.{" "}
                {textChannel && (
                  <Link href={`/app/s/${server.id}/${textChannel.id}`} className="font-semibold text-ember-2 hover:underline">
                    Ir para o #{textChannel.name}
                  </Link>
                )}
              </p>
            </div>
          ) : (
            <>
              <div className="mt-10 gap-4 [column-fill:_balance] sm:columns-2 xl:columns-3">
                {items.map((e, i) => (
                  <HallCard key={e.message.id} entry={e} server={server} first={i === 0} admin={admin} />
                ))}
              </div>
              {hall.hasMore && (
                <button type="button" onClick={() => void more()} disabled={busy} className="btn-quiet mt-6 h-10 px-4 text-[14px]">
                  {busy ? "Carregando…" : "Ver mais antigos"}
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function HallCard({ entry, server, first, admin }: { entry: HallEntry; server: Server; first: boolean; admin: boolean }) {
  const m = entry.message;
  const author = useUser(m.author?.id) ?? m.author;
  const me = useStore((s) => s.me);
  const nick = server.members.find((x) => x.user.id === author?.id)?.nickname;
  const name = nick || author?.display_name || "Alguém que saiu";
  const people = m.reactions.reduce((n, r) => n + r.count, 0);
  const channel = server.channels.find((c) => c.id === m.channel_id);

  async function remove() {
    if (!confirm("Tirar essa mensagem do Hall da Fama? Ela continua no canal.")) return;
    try {
      await api(`/servers/${server.id}/hall/${m.id}`, { method: "DELETE" });
    } catch (e) {
      toast(errorText(e));
    }
  }

  return (
    <article
      className={`group relative mb-4 break-inside-avoid rounded-[14px] border p-4 ${
        first ? "border-ember/40 bg-ember/[0.07]" : "border-oat/[0.06] bg-cocoa-2"
      }`}
    >
      <header className="flex items-center gap-2.5">
        {author && (
          <button type="button" onClick={(e) => openProfile(author.id, e.currentTarget, server.id)} className="press shrink-0 rounded-full">
            <Avatar name={author.display_name} avatar={author.avatar} accent={author.accent} size={34} />
          </button>
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-[14.5px] font-semibold" style={{ color: author ? `color-mix(in srgb, ${author.accent} 70%, var(--color-oat))` : undefined }}>
            {name}
          </p>
          <p className="text-[11.5px] text-oat/40">{sinceOf(m.created_at)}</p>
        </div>
        {first && <span className="label rounded-full bg-ember px-2 py-1 text-white">mais recente</span>}
      </header>

      {m.content && (
        <div className="mt-3 break-words text-[16px] leading-[1.45] text-oat/95">
          <RichText text={m.content} emojis={server.emojis} meUsername={me?.username ?? ""} onMention={() => {}} />
        </div>
      )}
      {m.attachments.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2 [&_video]:max-h-[260px]">
          {m.attachments.map((a) => (
            <AttachmentView key={a.id} a={a} />
          ))}
        </div>
      )}

      <footer className="mt-3 flex flex-wrap items-center gap-1.5">
        {m.reactions.map((r) => (
          <span key={r.emoji} className="flex h-7 items-center gap-1.5 rounded-full bg-cocoa-0/50 px-2 text-[13px]">
            <ReactionGlyph emoji={r.emoji} emojis={server.emojis} />
            <span className="font-semibold tabular-nums text-oat/80">{r.count}</span>
          </span>
        ))}
        <span className="ml-auto text-[12px] text-oat/40">
          {channel ? (
            <Link href={`/app/s/${server.id}/${channel.id}`} className="hover:text-oat/80 hover:underline">
              #{entry.channel_name}
            </Link>
          ) : (
            `#${entry.channel_name}`
          )}{" "}
          · entrou {agoOf(entry.added_at)}
        </span>
      </footer>
      <span className="sr-only">{people} reações</span>

      {admin && (
        <button
          type="button"
          onClick={() => void remove()}
          aria-label="Tirar do Hall"
          title="Tirar do Hall"
          className="press absolute -right-2 -top-2 hidden size-7 place-items-center rounded-full border border-oat/10 bg-cocoa-0 text-oat/60 hover:text-oat group-hover:grid"
        >
          <X className="size-4" />
        </button>
      )}
    </article>
  );
}
