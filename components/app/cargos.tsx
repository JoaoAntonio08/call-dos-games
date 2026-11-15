"use client";

import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { api, errorText } from "@/lib/api";
import { toast } from "@/lib/ui";
import type { Member, Perm, Role, Server } from "@/lib/types";
import { Section, Toggle } from "./bits";

/* ------------------------------------------------------------------ */
/* Cargos: o que cada um pode no servidor e quem vê/escreve em cada canal */
/* ------------------------------------------------------------------ */

export const PERM_LABELS: { key: Perm; label: string; hint: string }[] = [
  { key: "musica", label: "Pôr música", hint: "/tocar e a fila do YouTube junto" },
  { key: "dj", label: "DJ", hint: "pausa, pula e tira da fila a música de qualquer um" },
  { key: "comandos", label: "Comandos", hint: "/dado, /sortear, /enquete e comandos de bots" },
  { key: "hype", label: "Hype", hint: "chamar a turma para a call" },
  { key: "apelidos", label: "Apelidos", hint: "mudar o apelido dos outros" },
  { key: "moderar_voz", label: "Moderar call", hint: "mutar, ensurdecer, mover e tirar gente da call" },
];

const ROLE_COLORS = ["#f23f43", "#f0b232", "#23a55a", "#1abc9c", "#00a8fc", "#5865f2", "#9b59b6", "#eb459e", "#99aab5"];

async function call(path: string, method: string, json?: unknown) {
  try {
    return await api(path, { method, json });
  } catch (e) {
    toast(errorText(e));
    return null;
  }
}

function PermGrid({ value, onChange }: { value: Perm[]; onChange: (v: Perm[]) => void }) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {PERM_LABELS.map((p) => {
        const on = value.includes(p.key);
        return (
          <label key={p.key} className="flex cursor-pointer items-start gap-3 rounded-[11px] bg-cocoa-3 p-2.5">
            <Toggle checked={on} onChange={(v) => onChange(v ? [...value, p.key] : value.filter((x) => x !== p.key))} label={p.label} />
            <span className="min-w-0">
              <span className="block text-[14px] font-semibold">{p.label}</span>
              <span className="block text-[12px] leading-snug text-oat/45">{p.hint}</span>
            </span>
          </label>
        );
      })}
    </div>
  );
}

export function RoleChip({ role }: { role: Role }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-cocoa-0 px-2 py-0.5 text-[12px] font-semibold">
      <span className="size-2.5 rounded-full" style={{ background: role.color || "#99aab5" }} />
      {role.name}
    </span>
  );
}

export function RolesTab({ server }: { server: Server }) {
  const roles = server.roles ?? [];
  const [name, setName] = useState("");
  const [open, setOpen] = useState<string | null>(null);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    const color = ROLE_COLORS[roles.length % ROLE_COLORS.length];
    const r = (await call(`/servers/${server.id}/roles`, "POST", { name, color, perms: [] })) as { id: string } | null;
    if (r) {
      setName("");
      setOpen(r.id);
    }
  }

  return (
    <div className="max-w-2xl">
      <h2 className="mb-6 pr-10 font-display text-[30px] leading-tight">Cargos</h2>
      <Section title="Todo mundo" hint="Vale para quem não tem cargo nenhum. Dono e admins sempre podem tudo.">
        <PermGrid value={server.everyone_perms ?? []} onChange={(v) => void call(`/servers/${server.id}`, "PATCH", { everyone_perms: v })} />
      </Section>
      <Section title={`Cargos · ${roles.length}`} hint="Cargo soma permissões: quem tem dois cargos pode o que os dois liberam. Em Canais, dá para deixar um canal só para alguns cargos.">
        <form onSubmit={create} className="mb-3 flex gap-2">
          <input className="field h-10 flex-1" placeholder="Nome do cargo novo (ex.: DJ, Moderador, VIP)" value={name} maxLength={32} onChange={(e) => setName(e.target.value)} />
          <button type="submit" disabled={!name.trim()} className="btn-ember flex h-10 items-center gap-1.5 px-4 text-[14px]">
            <Plus className="size-4" /> Criar
          </button>
        </form>
        {roles.length === 0 && <p className="text-[13.5px] text-oat/45">Nenhum cargo ainda.</p>}
        <ul className="space-y-2">
          {roles.map((r) => (
            <RoleRow key={r.id} role={r} server={server} open={open === r.id} onToggle={() => setOpen(open === r.id ? null : r.id)} />
          ))}
        </ul>
      </Section>
    </div>
  );
}

function RoleRow({ role, server, open, onToggle }: { role: Role; server: Server; open: boolean; onToggle: () => void }) {
  const [name, setName] = useState(role.name);
  const count = server.members.filter((m) => m.roles?.includes(role.id)).length;
  const patch = (json: Partial<Role>) => void call(`/roles/${role.id}`, "PATCH", json);
  return (
    <li className="rounded-[12px] bg-cocoa-3">
      <button type="button" onClick={onToggle} aria-expanded={open} className="flex w-full items-center gap-3 p-3 text-left">
        <span className="size-3.5 shrink-0 rounded-full" style={{ background: role.color || "#99aab5" }} />
        <span className="min-w-0 flex-1 truncate font-semibold">{role.name}</span>
        <span className="shrink-0 text-[12.5px] text-oat/45">
          {count} {count === 1 ? "pessoa" : "pessoas"} · {role.perms.length} {role.perms.length === 1 ? "permissão" : "permissões"}
        </span>
      </button>
      {open && (
        <div className="space-y-3 border-t border-oat/[0.06] p-3">
          <div className="flex gap-2">
            <input className="field h-9 flex-1 !py-0" value={name} maxLength={32} onChange={(e) => setName(e.target.value)} aria-label="Nome do cargo" />
            {name.trim() && name !== role.name && (
              <button type="button" onClick={() => patch({ name })} className="btn-ember h-9 px-3 text-[13px]">
                Salvar
              </button>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {ROLE_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                aria-label={`Cor ${c}`}
                aria-pressed={role.color === c}
                onClick={() => patch({ color: c })}
                className="press size-7 rounded-full"
                style={{ background: c, boxShadow: role.color === c ? "0 0 0 2px var(--color-cocoa-3), 0 0 0 4px var(--color-oat)" : undefined }}
              />
            ))}
          </div>
          <PermGrid value={role.perms} onChange={(perms) => patch({ perms })} />
          <button
            type="button"
            onClick={async () => {
              if (confirm(`Apagar o cargo ${role.name}? Canais restritos a ele voltam a ser de todo mundo.`)) await call(`/roles/${role.id}`, "DELETE");
            }}
            className="press flex items-center gap-1.5 rounded-[9px] px-2.5 py-1.5 text-[13px] text-[#ff8f92] hover:bg-rust/15"
          >
            <Trash2 className="size-4" /> Apagar cargo
          </button>
        </div>
      )}
    </li>
  );
}

/** Escolha de cargos (vários). Vazio = todo mundo. */
export function RolePicker({ roles, value, onChange, empty }: { roles: Role[]; value: string[]; onChange: (v: string[]) => void; empty: string }) {
  if (!roles.length) return <p className="text-[12.5px] text-oat/40">Crie cargos na aba Cargos para restringir.</p>;
  return (
    <div className="flex flex-wrap gap-1.5">
      <button
        type="button"
        onClick={() => onChange([])}
        aria-pressed={!value.length}
        className={`press rounded-full px-2.5 py-1 text-[12.5px] font-semibold ${!value.length ? "bg-ember text-white" : "bg-cocoa-0 text-oat/60 hover:text-oat"}`}
      >
        {empty}
      </button>
      {roles.map((r) => {
        const on = value.includes(r.id);
        return (
          <button
            key={r.id}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(on ? value.filter((x) => x !== r.id) : [...value, r.id])}
            className={`press flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12.5px] font-semibold ${on ? "bg-oat text-cocoa-0" : "bg-cocoa-0 text-oat/60 hover:text-oat"}`}
          >
            <span className="size-2 rounded-full" style={{ background: r.color || "#99aab5" }} />
            {r.name}
          </button>
        );
      })}
    </div>
  );
}

/** Quem vê e quem escreve/fala num canal. */
export function ChannelAccess({ server, channelId }: { server: Server; channelId: string }) {
  const ch = server.channels.find((c) => c.id === channelId);
  if (!ch) return null;
  const roles = server.roles ?? [];
  const set = (json: Record<string, string[]>) => void call(`/channels/${ch.id}`, "PATCH", json);
  return (
    <div className="mt-3 space-y-2.5 rounded-[10px] bg-cocoa-2 p-2.5">
      <div>
        <p className="mb-1.5 text-[12px] font-semibold text-oat/55">Quem vê este canal</p>
        <RolePicker roles={roles} value={ch.view_roles ?? []} onChange={(v) => set({ view_roles: v })} empty="Todo mundo" />
      </div>
      <div>
        <p className="mb-1.5 text-[12px] font-semibold text-oat/55">{ch.type === "text" ? "Quem escreve aqui" : "Quem fala aqui (os outros só escutam)"}</p>
        <RolePicker roles={roles} value={ch.send_roles ?? []} onChange={(v) => set({ send_roles: v })} empty="Todo mundo" />
      </div>
    </div>
  );
}

/** Cargos de uma pessoa (na aba Membros). */
export function MemberRoles({ server, member }: { server: Server; member: Member }) {
  const roles = server.roles ?? [];
  if (!roles.length) return null;
  return (
    <div className="mt-1.5">
      <RolePicker
        roles={roles}
        value={member.roles ?? []}
        onChange={(v) => void call(`/servers/${server.id}/members/${member.user.id}/roles`, "PUT", { roles: v })}
        empty="Sem cargo"
      />
    </div>
  );
}
