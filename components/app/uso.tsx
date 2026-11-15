"use client";

import { useCallback, useEffect, useState } from "react";
import { MonitorUp } from "lucide-react";
import { api, errorText } from "@/lib/api";
import { useStore } from "@/lib/store";
import { toast } from "@/lib/ui";
import type { User } from "@/lib/types";
import { Avatar, FormError, Section, Toggle } from "./bits";

/* ------------------------------------------------------------------ */
/* Uso de transmissão: quem gasta quanto, limite automático e restrição */
/* ------------------------------------------------------------------ */

interface Block {
  platform: boolean;
  until: string | null;
  reason: "manual" | "auto";
}
interface Row {
  user: User | null;
  role?: string | null;
  seconds: number;
  bytes_up: number;
  bytes_out: number;
  block: Block | null;
}
interface Limit {
  enabled: boolean;
  gb: number;
  period: "dia" | "mes";
}
interface ServerUsage {
  days: number;
  total: { seconds: number; bytes_up: number; bytes_out: number };
  people: Row[];
  limit: Limit;
  live: { user_id: string; channel_id: string }[];
}
interface PlatformUsage {
  days: number;
  total: { seconds: number; bytes_up: number; bytes_out: number };
  servers: { id: string | null; name: string; seconds: number; bytes_up: number; bytes_out: number }[];
  people: Row[];
}

export const gb = (b: number) => {
  const g = b / 1e9;
  if (g >= 100) return `${Math.round(g)} GB`;
  if (g >= 0.995) return `${g.toFixed(1).replace(".", ",")} GB`;
  return `${Math.round(b / 1e6)} MB`;
};
const time = (s: number) => {
  if (s < 60) return s ? "menos de 1 min" : "—";
  const h = Math.floor(s / 3600);
  const m = Math.round((s % 3600) / 60);
  return h ? `${h} h ${m ? `${m} min` : ""}` : `${m} min`;
};
const blockText = (b: Block) => {
  const until = b.until ? `até ${new Date(b.until).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}` : "até liberar";
  return `${b.platform ? "Restrito na plataforma" : b.reason === "auto" ? "Passou do limite" : "Restrito"} · ${until}`;
};
const PERIODS: [number, string][] = [
  [1, "Hoje"],
  [7, "7 dias"],
  [30, "30 dias"],
];
const DURATIONS: [number | null, string][] = [
  [1, "1 hora"],
  [24, "1 dia"],
  [24 * 7, "7 dias"],
  [null, "Até liberar"],
];

function Periods({ days, setDays }: { days: number; setDays: (d: number) => void }) {
  return (
    <div className="flex gap-1 rounded-[11px] bg-cocoa-0 p-1" role="tablist" aria-label="Período">
      {PERIODS.map(([d, label]) => (
        <button
          key={d}
          type="button"
          role="tab"
          aria-selected={days === d}
          onClick={() => setDays(d)}
          className={`press rounded-[8px] px-3 py-1.5 text-[13px] font-semibold ${days === d ? "bg-cocoa-4 text-oat" : "text-oat/55 hover:text-oat"}`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function Totals({ total }: { total: { seconds: number; bytes_up: number; bytes_out: number } }) {
  return (
    <div className="grid grid-cols-3 overflow-hidden rounded-[14px] bg-cocoa-3">
      {[
        ["Saindo do servidor", gb(total.bytes_out), "o que pesa na banda/franquia"],
        ["Enviado por quem transmite", gb(total.bytes_up), "upload das pessoas"],
        ["Tempo transmitindo", time(total.seconds), "tela + câmera"],
      ].map(([label, value, hint], i) => (
        <div key={label} className={`px-3 py-3 ${i ? "border-l border-oat/10" : ""}`}>
          <p className="label text-oat/45">{label}</p>
          <p className="mt-1 font-display text-[24px] leading-none">{value}</p>
          <p className="mt-1 text-[11.5px] text-oat/35">{hint}</p>
        </div>
      ))}
    </div>
  );
}

function PersonRow({ row, top, live, onBlock, onUnblock, canAct }: { row: Row; top: number; live?: boolean; onBlock: (h: number | null) => void; onUnblock: () => void; canAct: boolean }) {
  const [menu, setMenu] = useState(false);
  const u = row.user;
  if (!u) return null;
  const pct = top ? Math.max(2, (row.bytes_out / top) * 100) : 0;
  return (
    <li className="rounded-[12px] bg-cocoa-3 p-3">
      <div className="flex items-center gap-3">
        <Avatar name={u.display_name} avatar={u.avatar} accent={u.accent} size={34} />
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-2 truncate font-semibold">
            {u.display_name}
            {live && (
              <span className="flex items-center gap-1 rounded-full bg-rust/20 px-1.5 py-px text-[10.5px] font-bold uppercase text-[#ff8f92]">
                <MonitorUp className="size-3" /> ao vivo
              </span>
            )}
          </p>
          <p className="truncate text-[12px] text-oat/45">
            {gb(row.bytes_out)} saindo · {gb(row.bytes_up)} enviados · {time(row.seconds)}
          </p>
        </div>
        {canAct &&
          (row.block ? (
            <button
              type="button"
              onClick={onUnblock}
              disabled={row.block.platform && !canAct}
              className="press shrink-0 rounded-[9px] bg-cocoa-0 px-2.5 py-1.5 text-[12.5px] font-semibold text-moss hover:bg-cocoa-4"
            >
              Liberar
            </button>
          ) : (
            <div className="relative shrink-0">
              <button type="button" onClick={() => setMenu(!menu)} aria-expanded={menu} className="press rounded-[9px] bg-cocoa-0 px-2.5 py-1.5 text-[12.5px] font-semibold text-[#ff8f92] hover:bg-rust/20">
                Restringir
              </button>
              {menu && (
                <div className="pop-in absolute right-0 top-full z-10 mt-1 w-[150px] rounded-[11px] bg-cocoa-0 p-1 shadow-[0_8px_30px_rgb(0_0_0/0.4)]">
                  {DURATIONS.map(([h, label]) => (
                    <button
                      key={label}
                      type="button"
                      onClick={() => {
                        setMenu(false);
                        onBlock(h);
                      }}
                      className="block w-full rounded-[8px] px-2.5 py-1.5 text-left text-[13px] hover:bg-ember hover:text-white"
                    >
                      {label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-cocoa-0">
        <div className={`h-full rounded-full ${row.block ? "bg-rust" : "bg-ember"}`} style={{ width: `${pct}%` }} />
      </div>
      {row.block && <p className="mt-1.5 text-[12px] text-[#ff8f92]">{blockText(row.block)}</p>}
    </li>
  );
}

/** Aba "Uso" do servidor (dono, admins, cargo com "uso" e admin da plataforma). */
export function UsageTab({ serverId, title = "Uso de transmissão" }: { serverId: string; title?: string }) {
  const me = useStore((s) => s.me);
  const [days, setDays] = useState(1);
  const [data, setData] = useState<ServerUsage | null>(null);
  const [error, setError] = useState("");
  const [limit, setLimit] = useState<Limit | null>(null);

  const load = useCallback(async () => {
    try {
      const d = await api<ServerUsage>(`/servers/${serverId}/usage?days=${days}`);
      setData(d);
      setLimit((l) => l ?? d.limit);
      setError("");
    } catch (e) {
      setError(errorText(e));
    }
  }, [serverId, days]);
  useEffect(() => {
    const first = window.setTimeout(() => void load(), 0);
    const id = window.setInterval(() => void load(), 30_000);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(id);
    };
  }, [load]);

  async function act(path: string, method: string, json?: unknown) {
    try {
      await api(path, { method, json });
      await load();
    } catch (e) {
      toast(errorText(e));
    }
  }

  async function saveLimit(l: Limit) {
    setLimit(l);
    try {
      await api(`/servers/${serverId}/usage/limit`, { method: "PUT", json: l });
      toast(l.enabled ? `Limite salvo: ${String(l.gb).replace(".", ",")} GB por pessoa ${l.period === "dia" ? "por dia" : "por mês"}.` : "Limite automático desligado.");
    } catch (e) {
      toast(errorText(e));
    }
  }

  const top = Math.max(0, ...(data?.people.map((p) => p.bytes_out) ?? [0]));
  return (
    <div className="max-w-2xl">
      <h2 className="mb-2 pr-10 font-display text-[30px] leading-tight">{title}</h2>
      <p className="mb-5 text-[14px] leading-relaxed text-oat/55">
        Quanto cada um gastou transmitindo tela e câmera. “Saindo do servidor” é o que a transmissão custa: o que a pessoa envia vezes quem está assistindo. Voz, música e
        YouTube junto quase não contam.
      </p>
      <FormError>{error}</FormError>
      <div className="mb-4 flex items-center justify-between gap-3">
        <Periods days={days} setDays={setDays} />
        {data && data.live.length > 0 && <span className="text-[12.5px] text-oat/50">{data.live.length} transmitindo agora</span>}
      </div>
      {data && (
        <>
          <Totals total={data.total} />
          <Section title="Quem mais gasta">
            {data.people.length === 0 ? (
              <p className="text-[13.5px] text-oat/45">Ninguém transmitiu tela ou câmera nesse período.</p>
            ) : (
              <ul className="space-y-2">
                {data.people.map((p) => (
                  <PersonRow
                    key={p.user?.id}
                    row={p}
                    top={top}
                    live={data.live.some((l) => l.user_id === p.user?.id)}
                    canAct={!!p.user && p.user.id !== me?.id && p.role !== "owner" && !(p.block?.platform && !me?.platform_admin)}
                    onBlock={(h) => void act(`/servers/${serverId}/usage/block/${p.user!.id}`, "PUT", { hours: h })}
                    onUnblock={() => void act(`/servers/${serverId}/usage/block/${p.user!.id}`, "DELETE")}
                  />
                ))}
              </ul>
            )}
          </Section>
          {limit && (
            <Section
              title="Limite automático"
              hint="Quem passar do limite fica sem tela e câmera até o fim do dia (ou do mês), com um aviso. O microfone continua. Dono e admins não entram no limite. Dá para liberar antes aqui em cima."
            >
              <div className="flex flex-wrap items-center gap-3 rounded-[12px] bg-cocoa-3 p-3">
                <Toggle checked={limit.enabled} onChange={(enabled) => void saveLimit({ ...limit, enabled })} label="Limite automático" />
                <span className="text-[14px]">Cada pessoa pode gastar até</span>
                <input
                  type="number"
                  min={0.1}
                  step={0.5}
                  value={limit.gb}
                  onChange={(e) => setLimit({ ...limit, gb: Number(e.target.value) })}
                  onBlur={() => limit.gb > 0 && void saveLimit(limit)}
                  className="field h-9 !w-20 shrink-0 !py-0 text-center"
                  aria-label="Limite em GB"
                />
                <span className="text-[14px]">GB</span>
                <select
                  value={limit.period}
                  onChange={(e) => void saveLimit({ ...limit, period: e.target.value as Limit["period"] })}
                  className="h-9 rounded-[8px] bg-cocoa-0 px-2 text-[14px] outline-none"
                  aria-label="Período do limite"
                >
                  <option value="dia">por dia</option>
                  <option value="mes">por mês</option>
                </select>
              </div>
            </Section>
          )}
        </>
      )}
    </div>
  );
}

/** Aba "Plataforma" (só para o admin da plataforma): todos os servidores e quem mais gasta no geral. */
export function PlatformTab() {
  const me = useStore((s) => s.me);
  const [days, setDays] = useState(1);
  const [data, setData] = useState<PlatformUsage | null>(null);
  const [server, setServer] = useState<{ id: string; name: string } | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      setData(await api<PlatformUsage>(`/platform/usage?days=${days}`));
      setError("");
    } catch (e) {
      setError(errorText(e));
    }
  }, [days]);
  useEffect(() => {
    const first = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(first);
  }, [load]);

  async function act(path: string, method: string, json?: unknown) {
    try {
      await api(path, { method, json });
      await load();
    } catch (e) {
      toast(errorText(e));
    }
  }

  if (server) {
    return (
      <div>
        <button type="button" onClick={() => setServer(null)} className="label link-u mb-4 text-oat/55">
          ← Todos os servidores
        </button>
        <UsageTab serverId={server.id} title={server.name} />
      </div>
    );
  }

  const top = Math.max(0, ...(data?.people.map((p) => p.bytes_out) ?? [0]));
  return (
    <div className="max-w-2xl">
      <h2 className="mb-2 pr-10 font-display text-[30px] leading-tight">Plataforma</h2>
      <p className="mb-5 text-[14px] leading-relaxed text-oat/55">
        Você é admin da plataforma: vê o uso de transmissão de todos os servidores e pode restringir alguém em todos de uma vez.
      </p>
      <FormError>{error}</FormError>
      <div className="mb-4">
        <Periods days={days} setDays={setDays} />
      </div>
      {data && (
        <>
          <Totals total={data.total} />
          <Section title="Servidores">
            {data.servers.length === 0 ? (
              <p className="text-[13.5px] text-oat/45">Nenhuma transmissão nesse período.</p>
            ) : (
              <ul className="space-y-1.5">
                {data.servers.map((s) => (
                  <li key={s.id ?? "dm"}>
                    <button
                      type="button"
                      disabled={!s.id}
                      onClick={() => s.id && setServer({ id: s.id, name: s.name })}
                      className="press flex w-full items-center gap-3 rounded-[11px] bg-cocoa-3 px-3 py-2.5 text-left hover:bg-cocoa-4 disabled:cursor-default disabled:hover:bg-cocoa-3"
                    >
                      <span className="min-w-0 flex-1 truncate font-semibold">{s.name}</span>
                      <span className="shrink-0 text-[12.5px] text-oat/50">
                        {gb(s.bytes_out)} · {time(s.seconds)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Section>
          <Section title="Quem mais gasta (todos os servidores)" hint="Restringir aqui tira tela e câmera da pessoa em todos os servidores.">
            {data.people.length === 0 ? (
              <p className="text-[13.5px] text-oat/45">Ninguém transmitiu nesse período.</p>
            ) : (
              <ul className="space-y-2">
                {data.people.map((p) => (
                  <PersonRow
                    key={p.user?.id}
                    row={p}
                    top={top}
                    canAct={!!p.user && p.user.id !== me?.id}
                    onBlock={(h) => void act(`/platform/usage/block/${p.user!.id}`, "PUT", { hours: h })}
                    onUnblock={() => void act(`/platform/usage/block/${p.user!.id}`, "DELETE")}
                  />
                ))}
              </ul>
            )}
          </Section>
        </>
      )}
    </div>
  );
}
