"use client";

import Link from "next/link";
import { Plus } from "lucide-react";
import { isUnread, useStore } from "@/lib/store";
import { openModal, useRoute } from "@/lib/ui";
import { ServerIcon } from "./bits";

/** Coluna da esquerda: casa (amigos e conversas) e a "estante" de servidores. */
export function ServerRail() {
  const route = useRoute();
  const order = useStore((s) => s.serverOrder);
  const servers = useStore((s) => s.servers);
  const reads = useStore((s) => s.reads);
  const dms = useStore((s) => s.dms);
  const pending = useStore((s) => s.friends.filter((f) => f.relation === "incoming").length);
  const voice = useStore((s) => s.voice);

  const homeActive = route.kind !== "server";
  const dmUnread = dms.filter((d) => isUnread(d.id, d.last_message_id, reads)).length;

  return (
    <nav aria-label="Servidores" className="flex w-[72px] shrink-0 flex-col items-center gap-2 overflow-y-auto bg-cocoa-0 py-3">
      <RailItem href="/app" active={homeActive} label="Início: amigos e conversas" badge={dmUnread + pending}>
        <span className={`grid size-12 place-items-center rounded-[16px] font-display text-[22px] transition-colors ${homeActive ? "bg-ember text-white" : "bg-cocoa-3 text-oat group-hover:bg-ember group-hover:text-white"}`}>
          c
        </span>
      </RailItem>

      <span className="my-1 h-[2px] w-7 rounded-full bg-oat/10" />

      {order.map((id) => {
        const s = servers[id];
        if (!s) return null;
        const active = route.kind === "server" && route.serverId === id;
        const unread = s.channels.some((c) => c.type === "text" && isUnread(c.id, c.last_message_id, reads));
        const live = s.channels.some((c) => c.type === "voice" && (voice[c.id]?.length ?? 0) > 0);
        return (
          <RailItem key={id} href={`/app/s/${id}`} active={active} label={s.name} dot={unread && !active} live={live}>
            <ServerIcon name={s.name} icon={s.icon} accent={s.accent} size={48} className={`wobble transition-[border-radius] ${active ? "!rounded-[16px]" : ""}`} />
          </RailItem>
        );
      })}

      <button
        type="button"
        onClick={() => openModal({ kind: "create-server" })}
        title="Criar ou entrar num servidor"
        aria-label="Criar ou entrar num servidor"
        className="press grid size-12 shrink-0 place-items-center rounded-[16px] border-2 border-dashed border-oat/20 text-oat/60 hover:border-ember hover:text-ember"
      >
        <Plus className="size-5" />
      </button>
    </nav>
  );
}

function RailItem({
  href,
  active,
  label,
  badge,
  dot,
  live,
  children,
}: {
  href: string;
  active: boolean;
  label: string;
  badge?: number;
  dot?: boolean;
  live?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link href={href} title={label} aria-label={label} aria-current={active ? "page" : undefined} className="group relative flex w-full justify-center">
      {/* marcador da esquerda: aba de fichário */}
      <span
        aria-hidden
        className={`absolute left-0 top-1/2 w-1 -translate-y-1/2 rounded-r-full bg-oat transition-all duration-200 ${
          active ? "h-9" : dot ? "h-2" : "h-0 group-hover:h-4"
        }`}
      />
      {children}
      {!!badge && (
        <span className="absolute -bottom-0.5 right-2.5 grid h-5 min-w-5 place-items-center rounded-full bg-rust px-1 text-[11px] font-bold text-oat ring-4 ring-cocoa-0">
          {badge > 9 ? "9+" : badge}
        </span>
      )}
      {live && !badge && (
        <span title="Tem gente na call" className="absolute -bottom-0.5 right-2.5 grid size-5 place-items-center rounded-full bg-moss ring-4 ring-cocoa-0">
          <span className="block size-1.5 rounded-full bg-cocoa-0" />
        </span>
      )}
    </Link>
  );
}
