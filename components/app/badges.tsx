import { badgesOf } from "@/lib/badges";
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
