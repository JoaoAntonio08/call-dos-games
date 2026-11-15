"use client";

import { useEffect, useState } from "react";
import { Bot, Check, Copy, Gamepad2, Trash2 } from "lucide-react";
import { api, errorText } from "@/lib/api";
import { useStore } from "@/lib/store";
import { toast } from "@/lib/ui";
import type { Server, SteamProfile } from "@/lib/types";
import { FormError, Section, Tip } from "./bits";

/* ------------------------------------------------------------------ */
/* Steam: ligar a conta (configurações) e cartão no perfil             */
/* ------------------------------------------------------------------ */

export function SteamSettings() {
  const enabled = useStore((s) => s.features.steam);
  const me = useStore((s) => s.me);
  const [steam, setSteam] = useState<SteamProfile | null | undefined>(undefined);
  const [link, setLink] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!me || !enabled) return;
    api<{ steam: SteamProfile | null }>(`/users/${me.id}/steam`)
      .then((r) => setSteam(r.steam))
      .catch(() => setSteam(null));
  }, [me, enabled]);

  async function save(profile: string) {
    setBusy(true);
    setError("");
    try {
      const r = await api<{ steam: SteamProfile | null }>("/me/steam", { method: "PUT", json: { profile } });
      setSteam(r.steam);
      setLink("");
      toast(r.steam ? "Steam ligada ao seu perfil." : "Steam desligada.");
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section
      title="Steam"
      hint={
        enabled
          ? "Para aparecer o que você está jogando, o perfil e os detalhes de jogo precisam estar públicos na Steam (Editar perfil → Privacidade)."
          : undefined
      }
    >
      {!enabled ? (
        <p className="text-[13.5px] text-oat/55">
          A integração com a Steam ainda não está ligada no servidor da turma. Quem cuida do servidor precisa colocar a <b>STEAM_API_KEY</b> no backend.
        </p>
      ) : steam ? (
        <div className="flex items-center gap-3 rounded-[14px] bg-cocoa-3 p-3">
          <Gamepad2 className="size-8 shrink-0 text-ember" />
          <div className="min-w-0 flex-1">
            <p className="truncate font-semibold">{steam.name || "Perfil da Steam"}</p>
            <p className="truncate text-[12.5px] text-oat/50">
              {steam.playing ? `Jogando ${steam.playing.name}` : steam.public ? "Ligada" : "Perfil fechado: a Steam não mostra seus jogos"}
            </p>
          </div>
          <button type="button" disabled={busy} onClick={() => void save("")} className="btn-quiet h-9 px-3.5 text-[13.5px]">
            Desligar
          </button>
        </div>
      ) : (
        <form
          className="flex flex-wrap gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (link.trim()) void save(link);
          }}
        >
          <input
            className="field min-w-[220px] flex-1"
            value={link}
            onChange={(e) => setLink(e.target.value)}
            placeholder="steamcommunity.com/id/seu-perfil"
            aria-label="Link do seu perfil da Steam"
          />
          <button type="submit" disabled={busy || !link.trim()} className="btn-ember h-[46px] px-4 text-[14px]">
            Ligar Steam
          </button>
          <FormError>{error}</FormError>
        </form>
      )}
    </Section>
  );
}

export function SteamCard({ userId }: { userId: string }) {
  const enabled = useStore((s) => s.features.steam);
  const live = useStore((s) => s.games[userId]);
  const [steam, setSteam] = useState<SteamProfile | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    api<{ steam: SteamProfile | null }>(`/users/${userId}/steam`)
      .then((r) => alive && setSteam(r.steam))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [userId, enabled]);
  if (!steam) return null;
  const playing = live ?? steam.playing;
  return (
    <div className="mt-3">
      <p className="label mb-1.5 flex items-center gap-1.5 text-oat/45">
        <Gamepad2 className="size-3.5" /> Steam
      </p>
      {playing && (
        <div className="mb-2 flex items-center gap-2 rounded-[10px] bg-moss/15 px-2.5 py-2 text-[13px]">
          <span className="live-dot !bg-moss" />
          <span className="min-w-0 truncate">
            Jogando <b>{playing.name}</b>
          </span>
        </div>
      )}
      {steam.recent.length > 0 ? (
        <ul className="space-y-1">
          {steam.recent.slice(0, 4).map((g) => (
            <li key={g.appid} className="flex items-center gap-2.5 text-[12.5px]">
              <img src={g.image} alt="" loading="lazy" referrerPolicy="no-referrer" className="h-[23px] w-[62px] shrink-0 rounded-[4px] bg-cocoa-3 object-cover" />
              <span className="min-w-0 flex-1 truncate">{g.name}</span>
              <span className="shrink-0 tabular-nums text-oat/45">{g.hours_2weeks}h</span>
            </li>
          ))}
        </ul>
      ) : (
        !playing && <p className="text-[12.5px] text-oat/45">{steam.public ? "Nada jogado nas últimas 2 semanas." : "Perfil fechado na Steam."}</p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* bots: webhooks por canal                                            */
/* ------------------------------------------------------------------ */

interface Hook {
  id: string;
  name: string;
  created_at: string;
  command_url: string;
  commands: string[];
}

/** Comandos com barra de um bot: a API chama o endereço dele quando alguém usa. */
function HookCommands({ hook, onSaved }: { hook: Hook; onSaved: (h: Hook) => void }) {
  const [open, setOpen] = useState(false);
  const [cmds, setCmds] = useState(hook.commands.map((c) => `/${c}`).join(", "));
  const [url, setUrl] = useState(hook.command_url);
  const [error, setError] = useState("");
  if (!open) {
    return (
      <button type="button" className="text-[12.5px] text-oat/55 hover:text-oat hover:underline" onClick={() => setOpen(true)}>
        {hook.commands.length ? `Comandos: ${hook.commands.map((c) => `/${c}`).join(", ")}` : "Adicionar comandos"}
      </button>
    );
  }
  return (
    <form
      className="mt-2 space-y-2"
      onSubmit={async (e) => {
        e.preventDefault();
        setError("");
        try {
          const commands = cmds.split(/[\s,]+/).map((c) => c.replace(/^\//, "")).filter(Boolean);
          const r = await api<{ command_url: string; commands: string[] }>(`/webhooks/${hook.id}`, { method: "PATCH", json: { command_url: url.trim(), commands } });
          onSaved({ ...hook, ...r });
          setOpen(false);
          toast("Comandos do bot salvos.");
        } catch (err) {
          setError(errorText(err));
        }
      }}
    >
      <input className="field" value={cmds} onChange={(e) => setCmds(e.target.value)} placeholder="/clima, /meme" aria-label={`Comandos do bot ${hook.name}`} />
      <input className="field font-mono text-[12.5px]" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://meu-bot.exemplo.com/comando" aria-label={`Endereço de comandos do bot ${hook.name}`} />
      <Tip>
        Quando alguém usa um desses comandos em qualquer canal do servidor, a API manda um POST com {"{command, args, user, channel_id}"} para o endereço,
        assinado no cabeçalho <code>X-CDG-Signature</code> (HMAC-SHA256 com o sha256 do token do webhook). O que o bot responder ({"{\"content\": \"...\"}"}) aparece no canal.
      </Tip>
      <div className="flex gap-2">
        <button type="submit" className="btn-ember h-9 px-3.5 text-[13.5px]">
          Salvar
        </button>
        <button type="button" className="btn-quiet h-9 px-3.5 text-[13.5px]" onClick={() => setOpen(false)}>
          Cancelar
        </button>
      </div>
      <FormError>{error}</FormError>
    </form>
  );
}

export function BotsTab({ server }: { server: Server }) {
  const text = server.channels.filter((c) => c.type === "text");
  const [channelId, setChannelId] = useState(text[0]?.id ?? "");
  const [hooks, setHooks] = useState<Hook[]>([]);
  const [name, setName] = useState("");
  const [created, setCreated] = useState<{ name: string; url: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!channelId) return;
    api<Hook[]>(`/channels/${channelId}/webhooks`)
      .then(setHooks)
      .catch((e) => setError(errorText(e)));
  }, [channelId]);

  async function create() {
    setError("");
    try {
      const r = await api<{ id: string; name: string; url: string }>(`/channels/${channelId}/webhooks`, { json: { name } });
      setCreated(r);
      setName("");
      setHooks(await api<Hook[]>(`/channels/${channelId}/webhooks`));
    } catch (e) {
      setError(errorText(e));
    }
  }

  async function remove(h: Hook) {
    try {
      await api(`/webhooks/${h.id}`, { method: "DELETE" });
      setHooks((l) => l.filter((x) => x.id !== h.id));
    } catch (e) {
      toast(errorText(e));
    }
  }

  return (
    <div className="max-w-2xl">
      <h2 className="mb-5 font-display text-[28px] font-semibold">Webhooks</h2>
      <p className="-mt-3 mb-5 text-[14px] leading-relaxed text-oat/55">
        Para quem programa o próprio bot (para montar um sem código, use a aba Bots). Um <b>webhook</b> é um link secreto que deixa um bot ou serviço de fora mandar mensagens num canal. Funciona com o mesmo formato do Discord, então
        dá para usar com GitHub, alertas de servidor, bots de RSS, IFTTT, n8n e afins: é só colar o link onde pediria um webhook do Discord.
      </p>
      <label className="mb-4 block text-[13px] text-oat/60">
        Canal
        <select
          value={channelId}
          onChange={(e) => {
            setChannelId(e.target.value);
            setCreated(null);
          }}
          className="field mt-1.5"
        >
          {text.map((c) => (
            <option key={c.id} value={c.id}>
              #{c.name}
            </option>
          ))}
        </select>
      </label>
      <form
        className="flex flex-wrap gap-2 rounded-[14px] bg-cocoa-3 p-4"
        onSubmit={(e) => {
          e.preventDefault();
          void create();
        }}
      >
        <input className="field min-w-[200px] flex-1" value={name} onChange={(e) => setName(e.target.value)} placeholder="Nome do bot (ex.: Avisos)" maxLength={40} aria-label="Nome do bot" />
        <button type="submit" disabled={name.trim().length < 2} className="btn-ember h-[46px] px-4 text-[14px]">
          <Bot className="size-4" /> Criar webhook
        </button>
        <FormError>{error}</FormError>
      </form>
      {created && (
        <div className="mt-4 rounded-[14px] border border-honey/40 bg-honey/10 p-4">
          <p className="text-[13.5px] font-semibold text-honey">Copie o link agora: ele não aparece de novo.</p>
          <div className="mt-2 flex gap-2">
            <input readOnly value={created.url} className="field flex-1 font-mono text-[12px]" aria-label="Link do webhook" onFocus={(e) => e.currentTarget.select()} />
            <button
              type="button"
              className="btn-quiet h-[46px] px-3.5"
              onClick={() => {
                void navigator.clipboard.writeText(created.url).then(() => {
                  setCopied(true);
                  window.setTimeout(() => setCopied(false), 1500);
                });
              }}
              aria-label="Copiar link do webhook"
            >
              {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
            </button>
          </div>
          <Tip>
            Teste: <code className="rounded bg-cocoa-0 px-1">{`curl -H "Content-Type: application/json" -d '{"content":"oi!"}' LINK`}</code>
          </Tip>
        </div>
      )}
      <div className="mt-5 space-y-2">
        {hooks.map((h) => (
          <div key={h.id} className="rounded-[12px] bg-cocoa-3 px-3 py-2.5">
            <div className="flex items-center gap-3">
              <Bot className="size-5 text-ember" />
              <span className="min-w-0 flex-1 truncate font-medium">{h.name}</span>
              <span className="text-[12px] text-oat/40">desde {new Date(h.created_at).toLocaleDateString("pt-BR")}</span>
              <button type="button" onClick={() => void remove(h)} aria-label={`Apagar webhook ${h.name}`} className="rounded-md p-1 text-rust hover:bg-rust/15">
                <Trash2 className="size-4" />
              </button>
            </div>
            <div className="pl-8">
              <HookCommands hook={h} onSaved={(n) => setHooks((l) => l.map((x) => (x.id === n.id ? n : x)))} />
            </div>
          </div>
        ))}
        {hooks.length === 0 && <p className="text-[13px] text-oat/45">Nenhum webhook neste canal ainda.</p>}
      </div>
    </div>
  );
}
