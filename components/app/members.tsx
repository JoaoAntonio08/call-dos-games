"use client";

import { nameColorOf } from "@/lib/badges";
import { Crown, Gamepad2, Shield } from "lucide-react";
import { useStore } from "@/lib/store";
import { openProfile, openUserMenu } from "@/lib/ui";
import type { Member, Server } from "@/lib/types";
import { Avatar } from "./bits";

export function MemberList({ server }: { server: Server }) {
  const presence = useStore((s) => s.presence);
  const users = useStore((s) => s.users);
  const games = useStore((s) => s.games);
  const status = (m: Member) => presence[m.user.id]?.status ?? m.user.status;
  const online = server.members.filter((m) => status(m) !== "offline");
  const offline = server.members.filter((m) => status(m) === "offline");

  return (
    <aside aria-label="Membros" className="hidden w-[240px] shrink-0 overflow-y-auto bg-cocoa-2 px-2 pb-4 lg:block" style={{ ["--dot-ring" as string]: "var(--color-cocoa-2)" }}>
      {[
        ["Online", online],
        ["Offline", offline],
      ].map(([title, list]) =>
        (list as Member[]).length ? (
          <div key={title as string}>
            <p className="label px-2 pb-1.5 pt-5 text-oat/40">
              {title as string} — {(list as Member[]).length}
            </p>
            {(list as Member[]).map((m) => {
              const u = users[m.user.id] ?? m.user;
              const st = status(m);
              const custom = presence[m.user.id]?.custom_status ?? u.custom_status;
              return (
                <button
                  key={m.user.id}
                  type="button"
                  onClick={(e) => openProfile(u.id, e.currentTarget, server.id)}
                  onContextMenu={(e) => openUserMenu(e, u.id, server.id)}
                  className={`group flex w-full items-center gap-2.5 rounded-[10px] px-2 py-1.5 text-left hover:bg-cocoa-3 ${st === "offline" ? "opacity-45 hover:opacity-100" : ""}`}
                >
                  <Avatar name={u.display_name} avatar={u.avatar} accent={u.accent} size={34} status={st} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <span className="truncate text-[14.5px] font-medium" style={{ color: nameColorOf(u, 60) }}>
                        {m.nickname || u.display_name}
                      </span>
                      {m.role === "owner" && <Crown className="size-3.5 shrink-0 text-honey" aria-label="Dono" />}
                      {m.role === "admin" && <Shield className="size-3.5 shrink-0 text-oat/50" aria-label="Admin" />}
                    </span>
                    {games[u.id] && st !== "offline" ? (
                      <span className="flex items-center gap-1 truncate text-[12px] text-moss">
                        <Gamepad2 className="size-3.5 shrink-0" />
                        <span className="truncate">Jogando {games[u.id].name}</span>
                      </span>
                    ) : (
                      custom && st !== "offline" && <span className="block truncate text-[12px] text-oat/45">{custom}</span>
                    )}
                  </span>
                </button>
              );
            })}
          </div>
        ) : null,
      )}
    </aside>
  );
}
