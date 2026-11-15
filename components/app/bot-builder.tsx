"use client";

import { useEffect, useState } from "react";
import { Bot, Plus, Trash2, X } from "lucide-react";
import { api, errorText } from "@/lib/api";
import { toast } from "@/lib/ui";
import type { Server } from "@/lib/types";
import { FormError, Section, Toggle } from "./bits";
import { RolePicker } from "./cargos";

/* ------------------------------------------------------------------ */
/* Criar bot sem código: escolhe o que ele faz e configura cada parte  */
/* ------------------------------------------------------------------ */

type Rule = { trigger: string; reply: string; exact?: boolean };
type Reminder = { channel: string; time: string; days: number[]; text: string };
type ModuleCfg = {
  enabled: boolean;
  channels?: string[];
  roles?: string[];
  channel?: string | null;
  text?: string;
  rules?: Rule[];
  words?: string[];
  warning?: string;
  items?: Reminder[];
};
type Modules = Record<string, ModuleCfg>;
interface ServerBot {
  id: string;
  name: string;
  color: string;
  modules: Modules;
}

const CATALOG: { key: string; emoji: string; label: string; what: string }[] = [
  { key: "musica", emoji: "🎵", label: "Música", what: "/tocar nome ou link, /fila e /pular. Toca na call de quem pediu; só quem pôs (ou DJ) pausa e pula." },
  { key: "diversao", emoji: "🎲", label: "Diversão", what: "/dado, /moeda, /sortear e /escolher." },
  { key: "enquete", emoji: "📊", label: "Enquete", what: "/enquete pergunta | opção 1 | opção 2 e a turma vota reagindo." },
  { key: "boas_vindas", emoji: "👋", label: "Boas-vindas", what: "Manda um recado quando alguém entra no servidor." },
  { key: "auto_resposta", emoji: "💬", label: "Respostas automáticas", what: "Quando alguém escreve uma palavra ou frase, o bot responde." },
  { key: "filtro", emoji: "🚫", label: "Filtro de palavras", what: "Apaga mensagens com palavras proibidas e avisa só quem mandou." },
  { key: "lembretes", emoji: "⏰", label: "Lembretes", what: "Mensagens agendadas por dia da semana e horário (Brasília)." },
  { key: "cargo_automatico", emoji: "🏷️", label: "Cargo automático", what: "Dá cargos para quem entra no servidor." },
];
const DAYS = ["D", "S", "T", "Q", "Q", "S", "S"];
const DAY_NAMES = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];
const BOT_COLORS = ["#5865f2", "#23a55a", "#f0b232", "#f23f43", "#eb459e", "#1abc9c", "#9b59b6"];

const defaults = (key: string, firstText: string): ModuleCfg => {
  switch (key) {
    case "boas_vindas":
      return { enabled: true, channel: firstText, text: "Chegou {nome}! Bem-vindo(a) ao {servidor} 🎉" };
    case "auto_resposta":
      return { enabled: true, channels: [], rules: [{ trigger: "bom dia", reply: "Bom dia, {nome}! ☀️" }] };
    case "filtro":
      return { enabled: true, channels: [], words: [], warning: "Sua mensagem foi apagada: tem uma palavra que não pode aqui." };
    case "lembretes":
      return { enabled: true, items: [{ channel: firstText, time: "21:00", days: [5, 6], text: "Bora jogar? 🎮" }] };
    case "cargo_automatico":
      return { enabled: true, roles: [] };
    default:
      return { enabled: true, channels: [], roles: [] };
  }
};

export function BotBuilder({ server }: { server: Server }) {
  const [bots, setBots] = useState<ServerBot[] | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api<{ bots: ServerBot[] }>(`/servers/${server.id}/bots`)
      .then((r) => setBots(r.bots))
      .catch((e) => setError(errorText(e)));
  }, [server.id]);

  async function create() {
    try {
      const b = await api<ServerBot>(`/servers/${server.id}/bots`, {
        json: { name: `Bot ${(bots?.length ?? 0) + 1}`, color: BOT_COLORS[(bots?.length ?? 0) % BOT_COLORS.length], modules: {} },
      });
      setBots((l) => [...(l ?? []), b]);
      setEditing(b.id);
    } catch (e) {
      setError(errorText(e));
    }
  }

  const current = bots?.find((b) => b.id === editing);
  if (current) {
    return (
      <BotEditor
        key={current.id}
        server={server}
        bot={current}
        onBack={() => setEditing(null)}
        onSaved={(b) => setBots((l) => l?.map((x) => (x.id === b.id ? b : x)) ?? null)}
        onDeleted={() => (setBots((l) => l?.filter((x) => x.id !== current.id) ?? null), setEditing(null))}
      />
    );
  }

  return (
    <div className="max-w-2xl">
      <h2 className="mb-2 pr-10 font-display text-[30px] leading-tight">Bots</h2>
      <p className="mb-6 text-[14px] leading-relaxed text-oat/60">
        Monte um bot sem programar: escolha o que ele faz, em quais canais e para quais cargos. Sem bot nenhum, música, diversão e enquete já funcionam para
        todos com o bot da casa.
      </p>
      <FormError>{error}</FormError>
      <div className="space-y-2">
        {bots?.map((b) => {
          const on = CATALOG.filter((c) => b.modules[c.key]?.enabled);
          return (
            <button key={b.id} type="button" onClick={() => setEditing(b.id)} className="press flex w-full items-center gap-3 rounded-[14px] bg-cocoa-3 p-3 text-left hover:bg-cocoa-4">
              <span className="grid size-10 shrink-0 place-items-center rounded-full text-white" style={{ background: b.color }}>
                <Bot className="size-5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold">{b.name}</span>
                <span className="block truncate text-[12.5px] text-oat/45">{on.length ? on.map((c) => `${c.emoji} ${c.label}`).join(" · ") : "Nada ligado ainda"}</span>
              </span>
              <span className="text-[13px] text-ember-2">Configurar</span>
            </button>
          );
        })}
      </div>
      <button type="button" onClick={() => void create()} disabled={!bots} className="btn-ember mt-4 flex h-10 items-center gap-1.5 px-4 text-[14px]">
        <Plus className="size-4" /> Criar bot
      </button>
      <Section title="O que um bot pode fazer">
        <ul className="grid gap-2 sm:grid-cols-2">
          {CATALOG.map((c) => (
            <li key={c.key} className="rounded-[12px] bg-cocoa-3 p-3">
              <p className="font-semibold">
                {c.emoji} {c.label}
              </p>
              <p className="mt-0.5 text-[12.5px] leading-snug text-oat/50">{c.what}</p>
            </li>
          ))}
        </ul>
      </Section>
    </div>
  );
}

function BotEditor({
  server,
  bot,
  onBack,
  onSaved,
  onDeleted,
}: {
  server: Server;
  bot: ServerBot;
  onBack: () => void;
  onSaved: (b: ServerBot) => void;
  onDeleted: () => void;
}) {
  const text = server.channels.filter((c) => c.type === "text");
  const roles = server.roles ?? [];
  const [name, setName] = useState(bot.name);
  const [color, setColor] = useState(bot.color);
  const [mods, setMods] = useState<Modules>(bot.modules);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const setMod = (key: string, patch: Partial<ModuleCfg>) => setMods((m) => ({ ...m, [key]: { ...(m[key] ?? defaults(key, text[0]?.id ?? "")), ...patch } }));

  async function save() {
    setBusy(true);
    setError("");
    try {
      const b = await api<ServerBot>(`/bots/${bot.id}`, { method: "PATCH", json: { name, color, modules: mods } });
      setMods(b.modules);
      onSaved(b);
      toast("Bot salvo.");
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  const channelPicker = (key: string, cfg: ModuleCfg) => (
    <div>
      <p className="mb-1.5 text-[12px] font-semibold text-oat/55">Em quais canais</p>
      <div className="flex flex-wrap gap-1.5">
        <Chip on={!cfg.channels?.length} onClick={() => setMod(key, { channels: [] })}>
          Todos
        </Chip>
        {text.map((c) => {
          const on = !!cfg.channels?.includes(c.id);
          return (
            <Chip key={c.id} on={on} onClick={() => setMod(key, { channels: on ? cfg.channels!.filter((x) => x !== c.id) : [...(cfg.channels ?? []), c.id] })}>
              #{c.name}
            </Chip>
          );
        })}
      </div>
    </div>
  );

  return (
    <div className="max-w-2xl">
      <button type="button" onClick={onBack} className="label link-u mb-4 text-oat/55">
        ← Bots
      </button>
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <span className="grid size-12 shrink-0 place-items-center rounded-full text-white" style={{ background: color }}>
          <Bot className="size-6" />
        </span>
        <input className="field h-10 min-w-0 flex-1" value={name} maxLength={32} onChange={(e) => setName(e.target.value)} aria-label="Nome do bot" />
        <div className="flex gap-1.5">
          {BOT_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              aria-label={`Cor ${c}`}
              aria-pressed={color === c}
              onClick={() => setColor(c)}
              className="press size-6 rounded-full"
              style={{ background: c, boxShadow: color === c ? "0 0 0 2px var(--color-cocoa-2), 0 0 0 4px var(--color-oat)" : undefined }}
            />
          ))}
        </div>
      </div>

      <div className="space-y-2.5">
        {CATALOG.map((c) => {
          const cfg = mods[c.key];
          const on = !!cfg?.enabled;
          return (
            <section key={c.key} className="rounded-[14px] bg-cocoa-3">
              <div className="flex items-start gap-3 p-3">
                <span className="text-[22px] leading-none">{c.emoji}</span>
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold">{c.label}</span>
                  <span className="block text-[12.5px] leading-snug text-oat/50">{c.what}</span>
                </span>
                <Toggle checked={on} onChange={(v) => setMod(c.key, { enabled: v })} label={`${c.label}: ${on ? "ligado" : "desligado"}`} />
              </div>
              {cfg && !on && ["musica", "diversao", "enquete"].includes(c.key) && (
                <p className="px-3 pb-3 text-[12px] text-oat/40">Desligado aqui: os comandos de {c.label.toLowerCase()} ficam desligados no servidor todo.</p>
              )}
              {on && cfg && (
                <div className="space-y-3 border-t border-oat/[0.06] p-3">
                  {["musica", "diversao", "enquete", "auto_resposta", "filtro"].includes(c.key) && channelPicker(c.key, cfg)}
                  {["musica", "diversao", "enquete"].includes(c.key) && (
                    <div>
                      <p className="mb-1.5 text-[12px] font-semibold text-oat/55">Quem pode usar</p>
                      <RolePicker roles={roles} value={cfg.roles ?? []} onChange={(v) => setMod(c.key, { roles: v })} empty="Todo mundo" />
                    </div>
                  )}
                  {c.key === "boas_vindas" && (
                    <>
                      <ChannelSelect label="Canal do recado" channels={text} value={cfg.channel ?? ""} onChange={(v) => setMod(c.key, { channel: v })} />
                      <Field label="Recado ({nome} vira o nome de quem chegou, {servidor} o nome do servidor)">
                        <textarea className="field min-h-[70px] py-2 text-[14px]" maxLength={500} value={cfg.text ?? ""} onChange={(e) => setMod(c.key, { text: e.target.value })} />
                      </Field>
                    </>
                  )}
                  {c.key === "auto_resposta" && (
                    <div className="space-y-2">
                      {(cfg.rules ?? []).map((r, i) => (
                        <div key={i} className="rounded-[10px] bg-cocoa-2 p-2">
                          <div className="flex gap-2">
                            <input
                              className="field h-9 flex-1 !py-0 text-[13.5px]"
                              placeholder="Quando alguém escrever…"
                              maxLength={60}
                              value={r.trigger}
                              onChange={(e) => setMod(c.key, { rules: cfg.rules!.map((x, j) => (j === i ? { ...x, trigger: e.target.value } : x)) })}
                            />
                            <IconX label="Tirar resposta" onClick={() => setMod(c.key, { rules: cfg.rules!.filter((_, j) => j !== i) })} />
                          </div>
                          <input
                            className="field mt-1.5 h-9 !py-0 text-[13.5px]"
                            placeholder="…o bot responde ({nome} = quem escreveu)"
                            maxLength={1000}
                            value={r.reply}
                            onChange={(e) => setMod(c.key, { rules: cfg.rules!.map((x, j) => (j === i ? { ...x, reply: e.target.value } : x)) })}
                          />
                          <label className="mt-1.5 flex items-center gap-2 text-[12px] text-oat/55">
                            <input
                              type="checkbox"
                              checked={!!r.exact}
                              onChange={(e) => setMod(c.key, { rules: cfg.rules!.map((x, j) => (j === i ? { ...x, exact: e.target.checked } : x)) })}
                            />
                            Só se a mensagem for exatamente isso
                          </label>
                        </div>
                      ))}
                      {(cfg.rules?.length ?? 0) < 30 && (
                        <button type="button" onClick={() => setMod(c.key, { rules: [...(cfg.rules ?? []), { trigger: "", reply: "" }] })} className="btn-quiet h-8 px-3 text-[13px]">
                          + Resposta
                        </button>
                      )}
                    </div>
                  )}
                  {c.key === "filtro" && (
                    <>
                      <Field label="Palavras proibidas (separe por vírgula)">
                        <WordsInput value={cfg.words ?? []} onChange={(words) => setMod(c.key, { words })} />
                      </Field>
                      <Field label="Aviso (só quem mandou vê)">
                        <input className="field h-9 !py-0 text-[13.5px]" maxLength={200} value={cfg.warning ?? ""} onChange={(e) => setMod(c.key, { warning: e.target.value })} />
                      </Field>
                    </>
                  )}
                  {c.key === "lembretes" && (
                    <div className="space-y-2">
                      {(cfg.items ?? []).map((it, i) => {
                        const upd = (p: Partial<Reminder>) => setMod(c.key, { items: cfg.items!.map((x, j) => (j === i ? { ...x, ...p } : x)) });
                        return (
                          <div key={i} className="space-y-1.5 rounded-[10px] bg-cocoa-2 p-2">
                            <div className="flex flex-wrap items-center gap-2">
                              <select value={it.channel} onChange={(e) => upd({ channel: e.target.value })} className="h-9 rounded-[8px] bg-cocoa-0 px-2 text-[13px] outline-none" aria-label="Canal">
                                {text.map((t) => (
                                  <option key={t.id} value={t.id}>
                                    #{t.name}
                                  </option>
                                ))}
                              </select>
                              <input type="time" value={it.time} onChange={(e) => upd({ time: e.target.value })} className="h-9 rounded-[8px] bg-cocoa-0 px-2 text-[13px] outline-none" aria-label="Horário" />
                              <span className="flex gap-1">
                                {DAYS.map((d, n) => {
                                  const on = it.days.includes(n);
                                  return (
                                    <button
                                      key={n}
                                      type="button"
                                      aria-pressed={on}
                                      aria-label={DAY_NAMES[n]}
                                      title={DAY_NAMES[n]}
                                      onClick={() => upd({ days: on ? it.days.filter((x) => x !== n) : [...it.days, n].sort() })}
                                      className={`press grid size-7 place-items-center rounded-full text-[11.5px] font-bold ${on ? "bg-ember text-white" : "bg-cocoa-0 text-oat/50"}`}
                                    >
                                      {d}
                                    </button>
                                  );
                                })}
                              </span>
                              <span className="ml-auto">
                                <IconX label="Tirar lembrete" onClick={() => setMod(c.key, { items: cfg.items!.filter((_, j) => j !== i) })} />
                              </span>
                            </div>
                            <input className="field h-9 !py-0 text-[13.5px]" placeholder="Mensagem" maxLength={1000} value={it.text} onChange={(e) => upd({ text: e.target.value })} />
                          </div>
                        );
                      })}
                      {(cfg.items?.length ?? 0) < 20 && text[0] && (
                        <button
                          type="button"
                          onClick={() => setMod(c.key, { items: [...(cfg.items ?? []), { channel: text[0].id, time: "20:00", days: [0, 1, 2, 3, 4, 5, 6], text: "" }] })}
                          className="btn-quiet h-8 px-3 text-[13px]"
                        >
                          + Lembrete
                        </button>
                      )}
                      <p className="text-[12px] text-oat/40">Sem dia marcado = todo dia. Horário de Brasília.</p>
                    </div>
                  )}
                  {c.key === "cargo_automatico" && (
                    <div>
                      <p className="mb-1.5 text-[12px] font-semibold text-oat/55">Cargos para quem entrar</p>
                      <RolePicker roles={roles} value={cfg.roles ?? []} onChange={(v) => setMod(c.key, { roles: v })} empty="Nenhum" />
                    </div>
                  )}
                </div>
              )}
            </section>
          );
        })}
      </div>

      <FormError>{error}</FormError>
      <div className="sticky bottom-0 mt-4 flex items-center gap-2 bg-cocoa-2 py-3">
        <button type="button" onClick={() => void save()} disabled={busy || !name.trim()} className="btn-ember h-10 px-5 text-[14px]">
          {busy ? "Salvando…" : "Salvar bot"}
        </button>
        <button
          type="button"
          onClick={async () => {
            if (!confirm(`Apagar o bot ${bot.name}?`)) return;
            try {
              await api(`/bots/${bot.id}`, { method: "DELETE" });
              onDeleted();
            } catch (e) {
              toast(errorText(e));
            }
          }}
          className="press ml-auto flex items-center gap-1.5 rounded-[9px] px-2.5 py-2 text-[13px] text-[#ff8f92] hover:bg-rust/15"
        >
          <Trash2 className="size-4" /> Apagar bot
        </button>
      </div>
    </div>
  );
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={`press rounded-full px-2.5 py-1 text-[12.5px] font-semibold ${on ? "bg-ember text-white" : "bg-cocoa-0 text-oat/60 hover:text-oat"}`}
    >
      {children}
    </button>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[12px] font-semibold text-oat/55">{label}</span>
      {children}
    </label>
  );
}

function ChannelSelect({ label, channels, value, onChange }: { label: string; channels: { id: string; name: string }[]; value: string; onChange: (v: string) => void }) {
  return (
    <Field label={label}>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="h-9 w-full rounded-[8px] bg-cocoa-0 px-2 text-[13.5px] outline-none">
        {channels.map((c) => (
          <option key={c.id} value={c.id}>
            #{c.name}
          </option>
        ))}
      </select>
    </Field>
  );
}

function IconX({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} aria-label={label} className="press grid size-9 shrink-0 place-items-center rounded-[9px] text-oat/45 hover:bg-cocoa-4 hover:text-oat">
      <X className="size-4" />
    </button>
  );
}

/** Lista separada por vírgula, editável como texto. */
function WordsInput({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const [raw, setRaw] = useState(value.join(", "));
  return (
    <input
      className="field h-9 !py-0 text-[13.5px]"
      value={raw}
      placeholder="ex.: palavra1, palavra2"
      onChange={(e) => {
        setRaw(e.target.value);
        onChange(
          e.target.value
            .split(",")
            .map((w) => w.trim())
            .filter(Boolean),
        );
      }}
    />
  );
}
