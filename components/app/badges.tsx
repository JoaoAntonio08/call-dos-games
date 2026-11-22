"use client";

import { useRef } from "react";
import { Crown, Radio, Users } from "lucide-react";
import { badgesOf, PLATES } from "@/lib/badges";
import type { User } from "@/lib/types";

export function BadgeRow({ user, className = "" }: { user: Pick<User, "badges" | "created_at">; className?: string }) {
  const list = badgesOf(user);
  if (!list.length) return null;
  return (
    <div className={`flex flex-wrap gap-1 ${className}`} aria-label="Insígnias">
      {list.map((b) => (
        <span key={b.id} title={b.label} className="inline-flex h-6 items-center gap-1 rounded-full bg-black/25 px-2 text-[11.5px] font-semibold text-oat/85">
          <span aria-hidden>{b.emoji}</span>
          {b.label}
        </span>
      ))}
    </div>
  );
}

const PLATE_ICON = { crown: Crown, radio: Radio, users: Users };

/** Placa da vitrine do perfil. A holográfica inclina e troca de cor com o mouse. */
export function Plate({ id, className = "" }: { id?: string; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const p = id ? PLATES[id] : undefined;
  if (!p) return null;
  const Icon = PLATE_ICON[p.icon];
  const move = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = ref.current;
    if (!el || e.pointerType === "touch") return;
    const r = el.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width - 0.5;
    const y = (e.clientY - r.top) / r.height - 0.5;
    el.style.setProperty("--rx", `${(-y * 12).toFixed(1)}deg`);
    el.style.setProperty("--ry", `${(x * 12).toFixed(1)}deg`);
    el.style.setProperty("--hue", `${Math.round(x * 140)}deg`);
  };
  const leave = () => {
    ref.current?.style.removeProperty("--rx");
    ref.current?.style.removeProperty("--ry");
    ref.current?.style.removeProperty("--hue");
  };
  return (
    <div ref={ref} onPointerMove={move} onPointerLeave={leave} className={`plate plate-${p.tone} ${className}`} title={`${p.title}: ${p.sub}`}>
      {p.tone === "holo" && <span className="plate-shine" aria-hidden />}
      <Icon className="relative size-6 shrink-0" aria-hidden />
      <span className="relative min-w-0">
        <b className="block truncate text-[14px] font-semibold">{p.title}</b>
        <span className="block truncate text-[11.5px] opacity-80">{p.sub}</span>
      </span>
    </div>
  );
}
