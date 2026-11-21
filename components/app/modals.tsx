"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Copy, Hash, ImagePlus, LogOut, Play, Trash2, Upload, Volume2 } from "lucide-react";
import { api, errorText, upload } from "@/lib/api";
import { logout, useStore } from "@/lib/store";
import { closeModal, toast, useUI } from "@/lib/ui";
import { useVoice, type VoicePrefs } from "@/lib/voice";
import type { Me, Server } from "@/lib/types";
import { BADGES, MAX_BADGES, nameColorOf, themeBgOf } from "@/lib/badges";
import { BadgeRow } from "./badges";
import { AnimImg, Avatar, CloseButton, FormError, Modal, Section, ServerIcon, Toggle, Tip } from "./bits";
import { keyName } from "./user-bar";
import { BotsTab, DiscordTab, SteamSettings } from "./integracoes";
import { DesktopAppSettings, DesktopGameSettings, hasDesktopApp } from "./jogo-app";
import { ChannelAccess, MemberRoles, RolesTab } from "./cargos";
import { BotBuilder } from "./bot-builder";
import { NotificationsTab } from "./avisos";
import { PlatformTab, UsageTab } from "./uso";
import { tintColor, useLook, type LookStyle } from "@/lib/aparencia";
import { LogoMark } from "./intro";
import { Room } from "livekit-client";

export function Modals() {
  const modal = useUI((s) => s.modal);
  const servers = useStore((s) => s.servers);
  if (!modal) return null;
  switch (modal.kind) {
    case "create-server":
      return <CreateServer />;
    case "invite":
      return servers[modal.serverId] ? <Invite server={servers[modal.serverId]} /> : null;
    case "create-channel":
      return servers[modal.serverId] ? <CreateChannel server={servers[modal.serverId]} type={modal.type} /> : null;
    case "settings":
      return <UserSettings tab={modal.tab} />;
    case "server-settings":
      return servers[modal.serverId] ? <ServerSettings server={servers[modal.serverId]} tab={modal.tab} /> : null;
  }
}

/* ------------------------------------------------------------------ */
/* criar ou entrar num servidor                                        */
/* ------------------------------------------------------------------ */

function CreateServer() {
  const router = useRouter();
  const me = useStore((s) => s.me)!;
  const [mode, setMode] = useState<"create" | "join">("create");
  const [name, setName] = useState(`Casa de ${me.display_name}`);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      let s: Server;
      if (mode === "create") s = await api<Server>("/servers", { json: { name } });
      else {
        const c = code.trim().replace(/.*\/convite\//, "").replace(/[^a-z0-9]/gi, "");
        s = await api<Server>(`/invites/${c}/join`, { method: "POST" });
      }
      useStore.setState((st) => ({ servers: { ...st.servers, [s.id]: s }, serverOrder: st.serverOrder.includes(s.id) ? st.serverOrder : [...st.serverOrder, s.id] }));
      closeModal();
      router.push(`/app/s/${s.id}`);
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={closeModal} label="Criar servidor" className="w-[min(460px,100%)]">
      <form onSubmit={submit} className="p-6">
        <div className="flex items-start justify-between">
          <h2 className="font-display text-[30px] leading-tight">{mode === "create" ? "Um cantinho novo" : "Entrar com convite"}</h2>
          <CloseButton onClick={closeModal} />
        </div>
        <p className="mt-1 text-[14px] text-oat/55">
          {mode === "create" ? "Servidor é a casa da turma: canais de texto, de voz, soundboard e emojis só de vocês." : "Cole o link ou o código que mandaram para você."}
        </p>
        <div className="mt-5">
          {mode === "create" ? (
            <label className="block">
              <span className="mb-1.5 block text-[13px] font-semibold text-oat/70">Nome do servidor</span>
              <input className="field" value={name} onChange={(e) => setName(e.target.value)} maxLength={48} autoFocus required />
            </label>
          ) : (
            <label className="block">
              <span className="mb-1.5 block text-[13px] font-semibold text-oat/70">Convite</span>
              <input className="field" value={code} onChange={(e) => setCode(e.target.value)} placeholder="https://…/convite/abcd2345 ou abcd2345" autoFocus required />
            </label>
          )}
        </div>
        <FormError>{error}</FormError>
        <button type="submit" disabled={busy} className="btn-ember mt-5 h-11 w-full text-[15px]">
          {busy ? "Só um instante…" : mode === "create" ? "Criar servidor" : "Entrar"}
        </button>
        <button type="button" onClick={() => (setMode(mode === "create" ? "join" : "create"), setError(""))} className="link-u mx-auto mt-4 block text-[13.5px] text-oat/55 hover:text-oat">
          {mode === "create" ? "Recebeu um convite? Entrar num servidor" : "Prefiro criar o meu"}
        </button>
      </form>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* convite                                                             */
/* ------------------------------------------------------------------ */

function Invite({ server }: { server: Server }) {
  const [code, setCode] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [expires, setExpires] = useState<number | null>(168);

  useEffect(() => {
    setCode(null);
    api<{ code: string }>(`/servers/${server.id}/invites`, { json: { expires_hours: expires } })
      .then((r) => setCode(r.code))
      .catch((e) => setError(errorText(e)));
  }, [server.id, expires]);

  const link = code ? `${location.origin}/convite/${code}` : "";

  return (
    <Modal open onClose={closeModal} label="Convidar" className="w-[min(480px,100%)]">
      <div className="p-6">
        <div className="flex items-start justify-between">
          <h2 className="font-display text-[28px] leading-tight">
            Chama a turma pra <span className="italic">{server.name}</span>
          </h2>
          <CloseButton onClick={closeModal} />
        </div>
        <p className="mt-1 text-[14px] text-oat/55">Manda esse link no grupo. Quem abrir cria a conta (ou entra) e já cai aqui dentro.</p>
        <div className="mt-5 flex gap-2">
          <input readOnly value={link || "Gerando convite…"} className="field h-11 flex-1 text-[14px]" onFocus={(e) => e.target.select()} />
          <button
            type="button"
            disabled={!code}
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(link);
                setCopied(true);
                window.setTimeout(() => setCopied(false), 1800);
              } catch {
                toast("Não deu para copiar. Selecione o link e copie na mão.");
              }
            }}
            className={`press flex h-11 w-[110px] items-center justify-center gap-2 rounded-[12px] text-[14px] font-semibold ${copied ? "bg-moss text-white" : "btn-ember"}`}
          >
            <Copy className="size-4" /> {copied ? "Copiado" : "Copiar"}
          </button>
        </div>
        <FormError>{error}</FormError>
        <div className="mt-4 flex items-center gap-2 text-[13px] text-oat/55">
          Vale por
          <select value={String(expires)} onChange={(e) => setExpires(e.target.value === "null" ? null : Number(e.target.value))} className="rounded-[8px] bg-cocoa-0 px-2 py-1 text-oat outline-none">
            <option value="24">1 dia</option>
            <option value="168">7 dias</option>
            <option value="null">para sempre</option>
          </select>
        </div>
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* criar canal                                                         */
/* ------------------------------------------------------------------ */

function CreateChannel({ server, type: initial }: { server: Server; type: "text" | "voice" }) {
  const router = useRouter();
  const [type, setType] = useState(initial);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <Modal open onClose={closeModal} label="Criar canal" className="w-[min(440px,100%)]">
      <form
        className="p-6"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            const c = await api<{ id: string }>(`/servers/${server.id}/channels`, { json: { name, type } });
            closeModal();
            router.push(`/app/s/${server.id}/${c.id}`);
          } catch (err) {
            setError(errorText(err));
            setBusy(false);
          }
        }}
      >
        <div className="flex items-start justify-between">
          <h2 className="font-display text-[28px]">Canal novo</h2>
          <CloseButton onClick={closeModal} />
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2">
          {(["text", "voice"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setType(t)}
              className={`press flex items-center gap-2.5 rounded-[12px] border-2 p-3 text-left ${type === t ? "border-ember bg-ember/10" : "border-transparent bg-cocoa-3 hover:bg-cocoa-4"}`}
            >
              {t === "text" ? <Hash className="size-5 text-oat/60" /> : <Volume2 className="size-5 text-oat/60" />}
              <span>
                <span className="block text-[14.5px] font-semibold">{t === "text" ? "Texto" : "Voz"}</span>
                <span className="block text-[12px] text-oat/50">{t === "text" ? "mensagens, prints, memes" : "call, tela e atividades"}</span>
              </span>
            </button>
          ))}
        </div>
        <label className="mt-4 block">
          <span className="mb-1.5 block text-[13px] font-semibold text-oat/70">Nome</span>
          <input className="field" value={name} onChange={(e) => setName(e.target.value)} placeholder={type === "text" ? "fofoca" : "Cinema"} maxLength={40} autoFocus required />
        </label>
        <FormError>{error}</FormError>
        <button type="submit" disabled={busy || !name.trim()} className="btn-ember mt-5 h-11 w-full text-[15px]">
          Criar canal
        </button>
      </form>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* moldura das configurações (abas à esquerda)                         */
/* ------------------------------------------------------------------ */

function SettingsFrame({
  title,
  tabs,
  tab,
  setTab,
  children,
  footer,
}: {
  title: string;
  tabs: [string, string][];
  tab: string;
  setTab: (t: string) => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <Modal open onClose={closeModal} label={title} className="flex h-[min(720px,calc(100svh-24px))] w-[min(940px,100%)] flex-col overflow-hidden sm:flex-row">
      <nav className="flex shrink-0 gap-1 overflow-x-auto bg-cocoa-1 p-3 sm:w-[210px] sm:flex-col sm:p-4">
        <p className="label hidden px-2 pb-2 text-oat/40 sm:block">{title}</p>
        {tabs.map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`press shrink-0 rounded-[9px] px-2.5 py-1.5 text-left text-[14.5px] font-medium ${tab === id ? "bg-cocoa-4 text-oat" : "text-oat/60 hover:bg-cocoa-3 hover:text-oat"}`}
          >
            {label}
          </button>
        ))}
        {footer && <div className="mt-auto hidden sm:block">{footer}</div>}
      </nav>
      <div className="relative min-h-0 flex-1 overflow-y-auto px-5 py-6 sm:px-8">
        <CloseButton onClick={closeModal} className="absolute right-4 top-4" />
        {children}
      </div>
    </Modal>
  );
}

function H({ children }: { children: React.ReactNode }) {
  return <h2 className="mb-6 pr-10 font-display text-[30px] leading-tight">{children}</h2>;
}

/** Botão que abre o seletor de arquivo. */
function FileButton({ accept, onFile, children, className = "btn-quiet h-9 px-3.5 text-[13.5px]" }: { accept: string; onFile: (f: File) => void; children: React.ReactNode; className?: string }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <button type="button" onClick={() => ref.current?.click()} className={`flex items-center gap-2 ${className}`}>
        {children}
      </button>
      <input
        ref={ref}
        type="file"
        accept={accept}
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) onFile(f);
        }}
      />
    </>
  );
}

/* ------------------------------------------------------------------ */
/* configurações da pessoa                                             */
/* ------------------------------------------------------------------ */

const THEMES: [string, string][] = [
  ["#5865f2", "#1f2023"],
  ["#eb459e", "#2a1640"],
  ["#f23f43", "#3b1d1d"],
  ["#f0b232", "#3a2410"],
  ["#23a55a", "#0f2a1d"],
  ["#00a8fc", "#0b1f33"],
  ["#9b59b6", "#1a1030"],
  ["#ff7a45", "#2b1310"],
];

/** Bolinhas de cor + "outra cor" (seletor livre). */
function Swatches({ value, colors, onPick, round = true }: { value: string; colors: string[]; onPick: (c: string) => void; round?: boolean }) {
  const shape = round ? "rounded-full" : "rounded-[11px]";
  return (
    <div className="flex flex-wrap gap-2">
      {colors.map((c) => (
        <button
          key={c}
          type="button"
          aria-label={`Cor ${c}`}
          aria-pressed={value === c}
          onClick={() => onPick(c)}
          className={`press size-9 ${shape}`}
          style={{ background: c, boxShadow: value === c ? "0 0 0 2px var(--color-cocoa-2), 0 0 0 4px var(--color-oat)" : undefined }}
        />
      ))}
      <label className={`press relative grid size-9 cursor-pointer place-items-center overflow-hidden ${shape} border-2 border-dashed border-oat/25 text-[11px] text-oat/50`} title="Outra cor">
        +
        <input type="color" value={value || "#5865f2"} onChange={(e) => onPick(e.target.value)} className="absolute inset-0 cursor-pointer opacity-0" />
      </label>
    </div>
  );
}

const ACCENTS = ["#5865f2", "#f23f43", "#f0b232", "#23a55a", "#1abc9c", "#00a8fc", "#9b59b6", "#eb459e", "#f2f3f5"];

function UserSettings({ tab: initial }: { tab?: string }) {
  const [tab, setTab] = useState(initial ?? "perfil");
  const platform = useStore((s) => !!s.me?.platform_admin);
  return (
    <SettingsFrame
      title="Suas configurações"
      tab={tab}
      setTab={setTab}
      tabs={[
        ["perfil", "Perfil"],
        ["voz", "Voz e vídeo"],
        ["jogos", "Jogos"],
        ["avisos", "Notificações"],
        ["aparencia", "Aparência"],
        ["conta", "Conta"],
        ...(hasDesktopApp() ? ([["app", "App de Windows"]] as [string, string][]) : []),
        ...(platform ? ([["plataforma", "Plataforma"]] as [string, string][]) : []),
      ]}
      footer={
        <button
          type="button"
          onClick={() => {
            closeModal();
            void logout();
          }}
          className="flex w-full items-center gap-2 rounded-[9px] px-2.5 py-1.5 text-[14px] text-[#ff8f92] hover:bg-rust hover:text-oat"
        >
          <LogOut className="size-4" /> Sair da conta
        </button>
      }
    >
      {tab === "perfil" && <ProfileTab goAccount={() => setTab("conta")} />}
      {tab === "voz" && <VoiceTab />}
      {tab === "jogos" && (
        <div className="max-w-xl">
          <H>Jogos</H>
          <SteamSettings />
          <DesktopGameSettings />
        </div>
      )}
      {tab === "conta" && <AccountTab />}
      {tab === "avisos" && <NotificationsTab />}
      {tab === "aparencia" && <LookTab />}
      {tab === "app" && (
        <div className="max-w-xl">
          <H>App de Windows</H>
          <DesktopAppSettings />
        </div>
      )}
      {tab === "plataforma" && platform && <PlatformTab />}
    </SettingsFrame>
  );
}

/** Estilizado (vidro tingido + entrada animada) ou Normal (sólido), e a cor do vidro. Fica neste aparelho. */
function LookTab() {
  const look = useLook();
  const me = useStore((s) => s.me);
  // "do servidor": a cor que o app já aplicou (depende do servidor aberto)
  const color = look.tint === "servidor" ? "var(--glass-tint)" : tintColor(look.tint, undefined, me?.accent);
  const styles: [LookStyle, string, string][] = [
    ["estilizado", "Estilizado", "Painéis de vidro na cor escolhida, fundo com brilho suave e entrada animada."],
    ["normal", "Normal", "O visual sólido de sempre, sem transparência. Mais leve em PC fraco."],
  ];
  const tints: [string, string][] = [
    ["servidor", "Do servidor aberto"],
    ["perfil", "Da minha cor de perfil"],
  ];
  return (
    <div className="max-w-xl">
      <H>Aparência</H>
      <Section title="Estilo" hint="Vale só neste aparelho.">
        <div className="grid gap-2 sm:grid-cols-2">
          {styles.map(([id, name, text]) => (
            <button
              key={id}
              type="button"
              aria-pressed={look.style === id}
              onClick={() => look.set({ style: id })}
              className={`press rounded-[12px] border p-3 text-left ${look.style === id ? "border-oat/40 bg-cocoa-4" : "border-oat/10 hover:bg-cocoa-3"}`}
            >
              <span
                className="mb-2 block h-14 rounded-[9px]"
                style={
                  id === "estilizado"
                    ? {
                        background: `radial-gradient(120% 90% at 20% 10%, color-mix(in srgb, ${color} 40%, transparent), transparent 60%), linear-gradient(135deg, color-mix(in srgb, ${color} 20%, transparent), #1e1f22)`,
                        boxShadow: "inset 0 1px 0 rgba(255,255,255,.18)",
                      }
                    : { background: "#2b2d31" }
                }
              />
              <span className="block text-[14.5px] font-medium">{name}</span>
              <span className="text-[12.5px] text-oat/50">{text}</span>
            </button>
          ))}
        </div>
      </Section>
      <Section title="Cor do vidro">
        <div className="mb-3 flex flex-wrap gap-2">
          {tints.map(([id, name]) => (
            <button
              key={id}
              type="button"
              aria-pressed={look.tint === id}
              onClick={() => look.set({ tint: id as "servidor" | "perfil" })}
              className={`press h-9 rounded-[9px] px-3 text-[13.5px] ${look.tint === id ? "bg-cocoa-4 text-oat" : "bg-cocoa-3 text-oat/70 hover:text-oat"}`}
            >
              {name}
            </button>
          ))}
        </div>
        <Swatches value={look.tint.startsWith("#") ? look.tint : ""} colors={ACCENTS} onPick={(c) => look.set({ tint: c as `#${string}` })} />
      </Section>
      <Section title="Entrada">
        <label className="flex items-center justify-between gap-4 py-1">
          <span>
            <span className="block text-[14.5px] font-medium">Animação ao abrir</span>
            <span className="text-[12.5px] text-oat/50">Uma vez por abertura. Clique ou aperte uma tecla para pular.</span>
          </span>
          <Toggle checked={look.intro} onChange={(x) => look.set({ intro: x })} label="Animação ao abrir" />
        </label>
        <button type="button" onClick={() => look.playIntro()} className="press mt-3 flex h-9 items-center gap-2 rounded-[9px] bg-cocoa-3 px-3 text-[13.5px] hover:bg-cocoa-4">
          <LogoMark tint={color} className="size-5" /> Ver a animação
        </button>
      </Section>
    </div>
  );
}

function useSaveMe() {
  return async (patch: Record<string, unknown>) => {
    try {
      const me = await api<Me>("/me", { method: "PATCH", json: patch });
      useStore.setState({ me });
      return true;
    } catch (e) {
      toast(errorText(e));
      return false;
    }
  };
}

function ProfileTab({ goAccount }: { goAccount: () => void }) {
  const me = useStore((s) => s.me)!;
  const save = useSaveMe();
  const [f, setF] = useState({ display_name: me.display_name, pronouns: me.pronouns, bio: me.bio, custom_status: me.custom_status });
  const [busy, setBusy] = useState<string | null>(null);
  const dirty = f.display_name !== me.display_name || f.pronouns !== me.pronouns || f.bio !== me.bio || f.custom_status !== me.custom_status;

  async function media(kind: "avatar" | "banner" | "join-sound", file: File | null) {
    setBusy(kind);
    try {
      const out = file ? await upload<Me>(`/me/${kind}`, file) : await api<Me>(`/me/${kind}`, { method: "DELETE" });
      useStore.setState({ me: out });
    } catch (e) {
      toast(errorText(e));
    }
    setBusy(null);
  }

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_300px]">
      <div>
        <H>Seu perfil</H>
        <Section title="Foto e banner" hint="PNG, JPG, GIF ou WebP. GIF e WebP animados ficam animados: parados na lista, mexendo quando passam o mouse ou abrem seu perfil. Foto até 10 MB, banner até 15 MB.">
          <div className="flex flex-wrap gap-2">
            <FileButton accept="image/png,image/jpeg,image/gif,image/webp" onFile={(f) => void media("avatar", f)} className="btn-ember h-9 px-3.5 text-[13.5px]">
              <ImagePlus className="size-4" /> {busy === "avatar" ? "Enviando…" : "Trocar foto"}
            </FileButton>
            {me.avatar && (
              <button type="button" onClick={() => void media("avatar", null)} className="btn-quiet h-9 px-3.5 text-[13.5px]">
                Tirar foto
              </button>
            )}
            <FileButton accept="image/png,image/jpeg,image/gif,image/webp" onFile={(f) => void media("banner", f)}>
              <ImagePlus className="size-4" /> {busy === "banner" ? "Enviando…" : "Trocar banner"}
            </FileButton>
            {me.banner && (
              <button type="button" onClick={() => void media("banner", null)} className="btn-quiet h-9 px-3.5 text-[13.5px]">
                Tirar banner
              </button>
            )}
          </div>
        </Section>
        <Section title="Nome">
          <input className="field" value={f.display_name} maxLength={32} onChange={(e) => setF({ ...f, display_name: e.target.value })} />
        </Section>
        <Section title="Usuário">
          <div className="flex items-center gap-3">
            <p className="text-[15px]">@{me.username}</p>
            <button type="button" onClick={goAccount} className="text-[13.5px] font-semibold text-ember-2 hover:underline">
              Trocar
            </button>
          </div>
        </Section>
        <Section title="Pronomes">
          <input className="field" value={f.pronouns} maxLength={24} placeholder="ele/dele, ela/dela…" onChange={(e) => setF({ ...f, pronouns: e.target.value })} />
        </Section>
        <Section title="Frase de status" hint="Aparece embaixo do seu nome. Ex.: “farmando runas”, “vendo Frieren”.">
          <input className="field" value={f.custom_status} maxLength={80} onChange={(e) => setF({ ...f, custom_status: e.target.value })} />
        </Section>
        <Section title="Sobre mim">
          <textarea className="field min-h-[96px] resize-y" value={f.bio} maxLength={300} onChange={(e) => setF({ ...f, bio: e.target.value })} />
          <p className="mt-1 text-right text-[11.5px] text-oat/35">{f.bio.length}/300</p>
        </Section>
        <Section title="Cor do perfil">
          <div className="flex flex-wrap gap-2">
            {ACCENTS.map((c) => (
              <button
                key={c}
                type="button"
                aria-label={`Cor ${c}`}
                onClick={() => void save({ accent: c })}
                className="press size-9 rounded-full"
                style={{ background: c, boxShadow: me.accent === c ? "0 0 0 2px var(--color-cocoa-2), 0 0 0 4px var(--color-oat)" : undefined }}
              />
            ))}
            <label className="press relative grid size-9 cursor-pointer place-items-center overflow-hidden rounded-full border-2 border-dashed border-oat/25 text-[11px] text-oat/50" title="Outra cor">
              +
              <input type="color" value={me.accent} onChange={(e) => void save({ accent: e.target.value })} className="absolute inset-0 cursor-pointer opacity-0" />
            </label>
          </div>
        </Section>
        <Section title="Tema do perfil" hint="Duas cores em degradê no seu cartão. Aparece para todo mundo que abrir seu perfil.">
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void save({ theme: [] })}
              className={`press h-9 rounded-[11px] px-3 text-[13px] font-semibold ${me.theme.length ? "bg-cocoa-0 text-oat/60" : "bg-oat text-cocoa-0"}`}
            >
              Sem tema
            </button>
            {THEMES.map((t) => {
              const on = me.theme[0] === t[0] && me.theme[1] === t[1];
              return (
                <button
                  key={t.join()}
                  type="button"
                  aria-label={`Tema ${t.join(" e ")}`}
                  aria-pressed={on}
                  onClick={() => void save({ theme: t })}
                  className="press size-9 rounded-[11px]"
                  style={{ background: `linear-gradient(180deg, ${t[0]}, ${t[1]})`, boxShadow: on ? "0 0 0 2px var(--color-cocoa-2), 0 0 0 4px var(--color-oat)" : undefined }}
                />
              );
            })}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-3 text-[13px] text-oat/60">
            {(["Cima", "Baixo"] as const).map((label, i) => (
              <label key={label} className="flex items-center gap-2">
                <span className="relative size-8 overflow-hidden rounded-[9px] border border-oat/15" style={{ background: me.theme[i] ?? THEMES[0][i] }}>
                  <input
                    type="color"
                    value={me.theme[i] ?? THEMES[0][i]}
                    onChange={(e) => {
                      const next = [...(me.theme.length === 2 ? me.theme : THEMES[0])];
                      next[i] = e.target.value;
                      void save({ theme: next });
                    }}
                    className="absolute inset-0 cursor-pointer opacity-0"
                  />
                </span>
                {label}
              </label>
            ))}
          </div>
        </Section>
        <Section title="Cor do nome" hint="A cor do seu nome no chat e na lista de membros.">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void save({ name_color: "" })}
              className={`press h-9 rounded-full px-3 text-[13px] font-semibold ${me.name_color ? "bg-cocoa-0 text-oat/60" : "bg-oat text-cocoa-0"}`}
            >
              Padrão
            </button>
            <Swatches value={me.name_color} colors={["#ff7aa2", "#ff8f5a", "#ffd166", "#7ee081", "#5ee0d6", "#6ec1ff", "#a99bff", "#f2f3f5"]} onPick={(c) => void save({ name_color: c })} />
          </div>
          <p className="mt-2 text-[14px] font-semibold" style={{ color: nameColorOf(me) }}>
            {f.display_name || me.display_name} <span className="font-normal text-oat/40">fica assim no chat</span>
          </p>
        </Section>
        <Section title="Insígnias" hint={`Escolha até ${MAX_BADGES}. Elas aparecem no seu perfil.`}>
          <div className="flex flex-wrap gap-1.5">
            {BADGES.map((b) => {
              const on = me.badges.includes(b.id);
              const full = !on && me.badges.length >= MAX_BADGES;
              return (
                <button
                  key={b.id}
                  type="button"
                  aria-pressed={on}
                  disabled={full}
                  onClick={() => void save({ badges: on ? me.badges.filter((x) => x !== b.id) : [...me.badges, b.id] })}
                  className={`press inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[13px] font-semibold disabled:opacity-35 ${
                    on ? "bg-ember text-white" : "bg-cocoa-0 text-oat/70 hover:text-oat"
                  }`}
                >
                  <span aria-hidden>{b.emoji}</span> {b.label}
                </button>
              );
            })}
          </div>
        </Section>
        <Section title="Som de entrada" hint="Toca para a turma quando você entra numa call. MP3, OGG, WAV ou M4A, até 2 MB (fica melhor com 1 a 3 segundos).">
          <div className="flex flex-wrap items-center gap-2">
            <FileButton accept="audio/*,.mp3,.ogg,.wav,.m4a,.webm" onFile={(f) => void media("join-sound", f)}>
              <Upload className="size-4" /> {busy === "join-sound" ? "Enviando…" : me.join_sound ? "Trocar som" : "Escolher som"}
            </FileButton>
            {me.join_sound && (
              <>
                <button type="button" onClick={() => void new Audio(me.join_sound!).play()} className="btn-quiet flex h-9 items-center gap-2 px-3.5 text-[13.5px]">
                  <Play className="size-4" /> Ouvir
                </button>
                <button type="button" onClick={() => void media("join-sound", null)} className="btn-quiet h-9 px-3.5 text-[13.5px]">
                  Tirar
                </button>
              </>
            )}
          </div>
        </Section>
        <div className="sticky bottom-0 -mx-1 flex justify-end gap-2 bg-cocoa-2 px-1 py-3">
          {dirty && (
            <>
              <button type="button" onClick={() => setF({ display_name: me.display_name, pronouns: me.pronouns, bio: me.bio, custom_status: me.custom_status })} className="link-u px-3 text-[14px] text-oat/60">
                Desfazer
              </button>
              <button type="button" onClick={() => void save(f).then((ok) => ok && toast("Perfil salvo."))} className="btn-ember h-10 px-5 text-[14px]">
                Salvar alterações
              </button>
            </>
          )}
        </div>
      </div>

      {/* prévia ao vivo do cartão */}
      <div className="lg:sticky lg:top-0 lg:self-start">
        <p className="label mb-3 text-oat/40">Prévia</p>
        <div className="overflow-hidden rounded-[18px] bg-cocoa-0" style={{ ["--dot-ring" as string]: me.theme[0] ?? "var(--color-cocoa-0)", background: themeBgOf(me) }}>
          <div className="h-[100px]" style={{ background: themeBgOf(me) ? "transparent" : `color-mix(in srgb, ${me.accent} 65%, #18191c)` }}>
            {me.banner && <AnimImg media={me.banner} alt="" className="size-full object-cover" play />}
          </div>
          <div className="px-4 pb-4">
            <span className="-mt-10 inline-block rounded-full p-1.5" style={{ background: me.theme[0] ?? "var(--color-cocoa-0)" }}>
              <Avatar name={f.display_name || me.display_name} avatar={me.avatar} accent={me.accent} size={72} status={me.status} play />
            </span>
            <BadgeRow user={me} className="mt-1" />
            <div className={`mt-2 rounded-[14px] p-3 ${me.theme.length ? "bg-black/40" : "bg-cocoa-2"}`}>
              <p className="font-display text-[22px] font-semibold leading-tight" style={{ color: me.name_color || undefined }}>
                {f.display_name || " "}
              </p>
              <p className="text-[13px] text-oat/55">
                @{me.username}
                {f.pronouns && ` · ${f.pronouns}`}
              </p>
              {f.custom_status && <p className="mt-2 text-[13px]">{f.custom_status}</p>}
              {f.bio && <p className="mt-2 whitespace-pre-wrap border-t border-oat/[0.08] pt-2 text-[13px] text-oat/80">{f.bio}</p>}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

type Check = { state: "idle" | "checking" | "free" | "taken"; reason?: string };

function UsernameField({ current, onSave }: { current: string; onSave: (u: string) => Promise<unknown> }) {
  const [value, setValue] = useState(current);
  const [check, setCheck] = useState<Check>({ state: "idle" });
  const changed = value !== current && value.length > 0;
  const shown: Check = changed ? check : { state: "idle" };

  useEffect(() => {
    if (!changed) return;
    const t = window.setTimeout(async () => {
      try {
        const r = await api<{ ok: boolean; reason?: string }>(`/usernames/check?u=${encodeURIComponent(value)}`);
        setCheck(r.ok ? { state: "free" } : { state: "taken", reason: r.reason });
      } catch {
        setCheck({ state: "idle" });
      }
    }, 350);
    return () => window.clearTimeout(t);
  }, [value, changed]);

  return (
    <div>
      <div className="flex gap-2">
        <div className="relative flex-1">
          <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-oat/35">@</span>
          <input
            className="field pl-7"
            value={value}
            maxLength={32}
            aria-describedby="username-check"
            onChange={(e) => {
              const next = e.target.value.toLowerCase().replace(/[^a-z0-9_.]/g, "");
              setValue(next);
              setCheck({ state: "checking" });
            }}
          />
        </div>
        {changed && (
          <button type="button" disabled={shown.state !== "free"} onClick={() => void onSave(value)} className="btn-ember px-4 text-[14px]">
            Salvar
          </button>
        )}
      </div>
      <p id="username-check" role="status" className="mt-1.5 min-h-[18px] text-[12.5px]">
        {shown.state === "checking" && <span className="text-oat/45">Vendo se está livre…</span>}
        {shown.state === "free" && <span className="text-moss">@{value} está livre.</span>}
        {shown.state === "taken" && <span className="text-[#ff8f92]">{shown.reason}</span>}
      </p>
    </div>
  );
}

function AccountTab() {
  const me = useStore((s) => s.me)!;
  const save = useSaveMe();
  const [pw, setPw] = useState({ current: "", new: "" });
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");
  return (
    <div className="max-w-xl">
      <H>Conta</H>
      <Section title="E-mail">
        <p className="text-[15px]">{me.email ?? "—"}</p>
        {me.has_google && <Tip>Conta ligada ao Google: dá para entrar pelo botão do Google.</Tip>}
      </Section>
      {!me.has_google && me.has_password && me.email && (
        <Section title="Ligar o Google" hint="Por segurança, confirme a senha desta conta e use no Google exatamente o mesmo e-mail verificado.">
          <GoogleLinkControl />
        </Section>
      )}
      <Section title="Usuário" hint="Letras minúsculas, números, ponto e _. É assim que a turma te adiciona. Dá para trocar quando quiser, desde que ninguém esteja usando.">
        <UsernameField key={me.username} current={me.username} onSave={(username) => save({ username }).then((r) => r && toast(`Agora você é @${username}.`))} />
      </Section>
      <Section title={me.has_password ? "Trocar senha" : "Criar uma senha"} hint={me.has_password ? "As outras sessões abertas saem quando você troca." : "Assim você também consegue entrar com e-mail e senha."}>
        <form
          className="space-y-2"
          onSubmit={async (e) => {
            e.preventDefault();
            setError("");
            setOk("");
            try {
              await api("/auth/password", { json: pw });
              setPw({ current: "", new: "" });
              setOk("Senha salva.");
              useStore.setState((s) => ({ me: s.me ? { ...s.me, has_password: true } : s.me }));
            } catch (err) {
              setError(errorText(err));
            }
          }}
        >
          {me.has_password && <input className="field" type="password" placeholder="Senha atual" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} autoComplete="current-password" />}
          <input className="field" type="password" placeholder="Senha nova (8+ caracteres)" value={pw.new} onChange={(e) => setPw({ ...pw, new: e.target.value })} minLength={8} autoComplete="new-password" />
          <button type="submit" disabled={pw.new.length < 8} className="btn-ember h-10 px-5 text-[14px]">
            Salvar senha
          </button>
          <FormError>{error}</FormError>
          {ok && <p className="text-[13.5px] text-moss">{ok}</p>}
        </form>
      </Section>
    </div>
  );
}

function GoogleLinkControl() {
  const ref = useRef<HTMLDivElement>(null);
  const [password, setPassword] = useState("");
  const [clientId, setClientId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<{ google_client_id: string | null }>("/auth/config")
      .then((c) => setClientId(c.google_client_id))
      .catch(() => setClientId(null));
  }, []);

  useEffect(() => {
    if (!clientId || !password || !ref.current) return;
    const el = ref.current;
    el.replaceChildren();
    const render = () => {
      window.google!.accounts.id.initialize({
        client_id: clientId,
        callback: async ({ credential }) => {
          setBusy(true);
          setError("");
          try {
            await api("/auth/google/link", { json: { credential, password } });
            useStore.setState((s) => ({ me: s.me ? { ...s.me, has_google: true } : s.me }));
            toast("Conta ligada ao Google.");
          } catch (err) {
            setError(errorText(err));
          } finally {
            setBusy(false);
          }
        },
      });
      window.google!.accounts.id.renderButton(el, { theme: "filled_black", size: "large", shape: "pill", text: "continue_with", locale: "pt-BR", width: 320 });
    };
    if (window.google) return render();
    let script = document.querySelector<HTMLScriptElement>('script[src="https://accounts.google.com/gsi/client"]');
    if (!script) {
      script = document.createElement("script");
      script.src = "https://accounts.google.com/gsi/client";
      script.async = true;
      document.head.appendChild(script);
    }
    script.addEventListener("load", render, { once: true });
    return () => script?.removeEventListener("load", render);
  }, [clientId, password]);

  if (!clientId) return <Tip>O login com Google não está configurado neste servidor.</Tip>;
  return (
    <div className="space-y-3">
      <input className="field" type="password" placeholder="Senha atual" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
      {password && <div ref={ref} aria-busy={busy} className="min-h-11 [color-scheme:light]" />}
      <FormError>{error}</FormError>
    </div>
  );
}

function VoiceTab() {
  const v = useVoice();
  const [devices, setDevices] = useState<{ audioinput: MediaDeviceInfo[]; audiooutput: MediaDeviceInfo[]; videoinput: MediaDeviceInfo[] }>({ audioinput: [], audiooutput: [], videoinput: [] });
  const [listening, setListening] = useState(false);
  const room = v.call.room;

  useEffect(() => {
    void Promise.all([Room.getLocalDevices("audioinput", false), Room.getLocalDevices("audiooutput", false), Room.getLocalDevices("videoinput", false)])
      .then(([a, o, c]) => setDevices({ audioinput: a, audiooutput: o, videoinput: c }))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!listening) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      v.setPrefs({ pttKey: e.code });
      setListening(false);
    };
    window.addEventListener("keydown", onKey, { once: true });
    return () => window.removeEventListener("keydown", onKey);
  }, [listening, v]);

  const set = (p: Partial<VoicePrefs>) => v.setPrefs(p);
  const fill = (n: number) => ({ ["--fill" as string]: `${n * 100}%` });

  return (
    <div className="max-w-xl">
      <H>Voz e vídeo</H>
      <Section title="Modo de entrada">
        <div className="grid grid-cols-2 gap-2">
          {[
            [false, "Detecção de voz", "o mic fica aberto"],
            [true, "Apertar para falar", "segura uma tecla"],
          ].map(([val, label, hint]) => (
            <button
              key={String(val)}
              type="button"
              onClick={() => set({ ptt: val as boolean })}
              className={`press rounded-[12px] border-2 p-3 text-left ${v.prefs.ptt === val ? "border-ember bg-ember/10" : "border-transparent bg-cocoa-3 hover:bg-cocoa-4"}`}
            >
              <span className="block text-[14.5px] font-semibold">{label as string}</span>
              <span className="text-[12.5px] text-oat/50">{hint as string}</span>
            </button>
          ))}
        </div>
        {v.prefs.ptt && (
          <div className="mt-3 flex items-center gap-3">
            <span className="text-[14px] text-oat/70">Tecla:</span>
            <button type="button" onClick={() => setListening(true)} className={`press min-w-[90px] rounded-[10px] px-3 py-2 text-[14px] font-bold ${listening ? "bg-ember text-white" : "bg-cocoa-0"}`}>
              {listening ? "Aperte uma tecla…" : keyName(v.prefs.pttKey)}
            </button>
            <Tip>Funciona com a aba do navegador em foco.</Tip>
          </div>
        )}
      </Section>
      <Section title="Microfone">
        <label className="flex items-center justify-between gap-4 py-1">
          <span>
            <span className="block text-[14.5px] font-medium">Redução de ruído</span>
            <span className="text-[12.5px] text-oat/50">Corta ventilador, teclado e barulho de fundo.</span>
          </span>
          <Toggle checked={v.prefs.noiseSuppression} onChange={(x) => set({ noiseSuppression: x })} label="Redução de ruído" />
        </label>
        <label className="mt-3 flex items-center justify-between gap-4 py-1">
          <span>
            <span className="block text-[14.5px] font-medium">Entrar mutado</span>
            <span className="text-[12.5px] text-oat/50">O microfone começa desligado quando você entra numa call.</span>
          </span>
          <Toggle checked={v.prefs.startMuted} onChange={(x) => set({ startMuted: x })} label="Entrar mutado" />
        </label>
      </Section>
      <Section title="Sons">
        <label className="block text-[14px]">
          <span className="flex justify-between">
            Efeitos sonoros (soundboard)
            <span className="tabular-nums text-oat/50">{Math.round(v.prefs.sfxVolume * 100)}%</span>
          </span>
          <input type="range" className="range mt-2 w-full text-oat" min={0} max={1} step={0.05} value={v.prefs.sfxVolume} style={fill(v.prefs.sfxVolume)} onChange={(e) => set({ sfxVolume: Number(e.target.value) })} aria-label="Volume dos efeitos sonoros" />
        </label>
        <label className="mt-4 block text-[14px]">
          <span className="flex justify-between">
            Entrada e saída da call
            <span className="tabular-nums text-oat/50">{Math.round(v.prefs.joinVolume * 100)}%</span>
          </span>
          <input type="range" className="range mt-2 w-full text-oat" min={0} max={1} step={0.05} value={v.prefs.joinVolume} style={fill(v.prefs.joinVolume)} onChange={(e) => set({ joinVolume: Number(e.target.value) })} aria-label="Volume de entrada e saída da call" />
        </label>
        <label className="mt-3 flex items-center justify-between gap-4 py-1">
          <span className="text-[14.5px] font-medium">Tocar o som de entrada personalizado de cada um</span>
          <Toggle checked={v.prefs.joinSounds} onChange={(x) => set({ joinSounds: x })} label="Sons de entrada" />
        </label>
      </Section>
      <Section
        title="Clipes"
        hint="Na call, o app guarda os últimos ~40 segundos e o botão de tesoura (ou Alt+C) salva o lance no canal de clipes. Com alguém em live, sai o vídeo da live; sem live, sai o áudio da call, ou a sua tela se você ligar “Só gravar minha tela para clipes” no botão de compartilhar (ninguém vê). No app de Windows, Alt+Shift+C clipa mesmo com o jogo na frente. Em PC mais fraco, desligue."
      >
        <label className="flex items-center justify-between gap-4 py-1">
          <span className="text-[14.5px] font-medium">Guardar os últimos segundos para clipar</span>
          <Toggle checked={v.prefs.clipBuffer} onChange={(x) => set({ clipBuffer: x })} label="Clipes" />
        </label>
      </Section>
      <Section title="Dispositivos" hint={room ? undefined : "A troca vale para a próxima call; dentro da call muda na hora."}>
        {(
          [
            ["audioinput", "Microfone"],
            ["audiooutput", "Saída de som"],
            ["videoinput", "Câmera"],
          ] as const
        ).map(([k, label]) =>
          devices[k].length ? (
            <label key={k} className="mb-3 block">
              <span className="mb-1 block text-[13px] text-oat/60">{label}</span>
              <select
                className="field h-10 !py-0"
                defaultValue={room?.getActiveDevice(k) ?? ""}
                onChange={(e) => {
                  if (room) void room.switchActiveDevice(k, e.target.value).catch(() => {});
                }}
              >
                {devices[k].map((d, i) => (
                  <option key={d.deviceId || i} value={d.deviceId}>
                    {d.label || `${label} ${i + 1}`}
                  </option>
                ))}
              </select>
            </label>
          ) : null,
        )}
        {!devices.audioinput.length && <Tip>O navegador só mostra os aparelhos depois que você libera o microfone (entre numa call uma vez).</Tip>}
      </Section>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* configurações do servidor                                           */
/* ------------------------------------------------------------------ */

function ServerSettings({ server, tab: initial }: { server: Server; tab?: string }) {
  const me = useStore((s) => s.me)!;
  const role = server.members.find((m) => m.user.id === me.id)?.role ?? "member";
  const admin = role !== "member";
  const [tab, setTab] = useState(initial ?? (admin ? "geral" : "sons"));
  const tabs: [string, string][] = [
    ...(admin ? ([["geral", "Visão geral"]] as [string, string][]) : []),
    ["eu", "Seu perfil aqui"],
    ["sons", "Soundboard"],
    ["emojis", "Emojis"],
    ...(admin
      ? ([
          ["canais", "Canais"],
          ["modelo", "Importar modelo"],
          ["cargos", "Cargos"],
          ["membros", "Membros"],
          ["bots", "Bots"],
          ["webhooks", "Webhooks"],
          ["discord", "Ponte com o Discord"],
        ] as [string, string][])
      : []),
    ...(admin || server.my_perms?.includes("uso") ? ([["uso", "Uso"]] as [string, string][]) : []),
  ];
  return (
    <SettingsFrame title={server.name} tab={tab} setTab={setTab} tabs={tabs}>
      {tab === "geral" && <ServerGeneral server={server} owner={role === "owner"} />}
      {tab === "eu" && <MyServerProfile server={server} />}
      {tab === "sons" && <SoundsTab server={server} admin={admin} />}
      {tab === "emojis" && <EmojisTab server={server} admin={admin} />}
      {tab === "canais" && <ChannelsTab server={server} />}
      {tab === "modelo" && <DiscordTemplateTab server={server} />}
      {tab === "membros" && <MembersTab server={server} owner={role === "owner"} />}
      {tab === "cargos" && <RolesTab server={server} />}
      {tab === "bots" && <BotBuilder server={server} />}
      {tab === "webhooks" && <BotsTab server={server} />}
      {tab === "discord" && <DiscordTab server={server} />}
      {tab === "uso" && <UsageTab serverId={server.id} />}
    </SettingsFrame>
  );
}

/** Frases que aparecem quando alguém entra no servidor. {nome} vira o nome da pessoa. */
function WelcomeLines({ server, onSave }: { server: Server; onSave: (lines: string[]) => Promise<unknown> }) {
  const saved = server.welcome_lines ?? [];
  const [text, setText] = useState(saved.join("\n"));
  const lines = text.split("\n").map((x) => x.trim()).filter(Boolean);
  const dirty = lines.join("\n") !== saved.join("\n");
  const sample = lines[0] ?? "{nome} puxou uma cadeira.";
  return (
    <Section title="Boas-vindas" hint="Uma frase por linha (até 12). {nome} vira o nome de quem chegou. Vazio usa as frases padrão.">
      <textarea
        className="field min-h-[96px] resize-y"
        value={text}
        placeholder={"{nome} chegou. Alguém passa a pipoca.\nOlha quem apareceu: {nome}!"}
        onChange={(e) => setText(e.target.value)}
      />
      <p className="mt-2 text-[13px] text-oat/55">
        <span aria-hidden>☕ </span>
        {sample.split("{nome}").join("Bia")}
      </p>
      {dirty && (
        <div className="mt-2 flex justify-end">
          <button type="button" onClick={() => void onSave(lines)} className="btn-ember h-9 px-4 text-[13.5px]">
            Salvar boas-vindas
          </button>
        </div>
      )}
    </Section>
  );
}

/** Apelido só neste servidor (cada pessoa troca o seu). */
function MyServerProfile({ server }: { server: Server }) {
  const me = useStore((s) => s.me)!;
  const mine = server.members.find((m) => m.user.id === me.id);
  const [nick, setNick] = useState(mine?.nickname ?? "");
  const dirty = nick.trim() !== (mine?.nickname ?? "");
  async function save(value: string) {
    try {
      await api(`/servers/${server.id}/members/${me.id}`, { method: "PATCH", json: { nickname: value } });
      setNick(value);
      toast(value ? `Aqui você é ${value}.` : "Apelido tirado.");
    } catch (e) {
      toast(errorText(e));
    }
  }
  return (
    <div className="max-w-xl">
      <H>Seu perfil aqui</H>
      <Section title="Apelido neste servidor" hint={`Só a turma de ${server.name} vê. Nos outros lugares continua "${me.display_name}".`}>
        <div className="flex gap-2">
          <input className="field flex-1" value={nick} maxLength={32} placeholder={me.display_name} onChange={(e) => setNick(e.target.value)} />
          {dirty && (
            <button type="button" onClick={() => void save(nick.trim())} className="btn-ember px-4 text-[14px]">
              Salvar
            </button>
          )}
        </div>
        {mine?.nickname && !dirty && (
          <button type="button" onClick={() => void save("")} className="mt-2 text-[13px] font-semibold text-oat/55 hover:text-oat">
            Tirar apelido
          </button>
        )}
      </Section>
    </div>
  );
}

function ServerGeneral({ server, owner }: { server: Server; owner: boolean }) {
  const router = useRouter();
  const [f, setF] = useState({ name: server.name, description: server.description });
  const [busy, setBusy] = useState<string | null>(null);
  const dirty = f.name !== server.name || f.description !== server.description;

  async function patch(p: Record<string, unknown>) {
    try {
      await api(`/servers/${server.id}`, { method: "PATCH", json: p });
    } catch (e) {
      toast(errorText(e));
    }
  }
  async function media(kind: "icon" | "banner", file: File) {
    setBusy(kind);
    try {
      await upload(`/servers/${server.id}/${kind}`, file);
    } catch (e) {
      toast(errorText(e));
    }
    setBusy(null);
  }

  return (
    <div className="max-w-xl">
      <H>Visão geral</H>
      <Section title="Ícone e capa" hint="Animados também valem. A capa aparece no topo da lista de canais.">
        <div className="flex items-center gap-4">
          <ServerIcon name={server.name} icon={server.icon} accent={server.accent} size={72} className="group" />
          <div className="flex flex-wrap gap-2">
            <FileButton accept="image/png,image/jpeg,image/gif,image/webp" onFile={(f) => void media("icon", f)} className="btn-ember h-9 px-3.5 text-[13.5px]">
              <ImagePlus className="size-4" /> {busy === "icon" ? "Enviando…" : "Trocar ícone"}
            </FileButton>
            <FileButton accept="image/png,image/jpeg,image/gif,image/webp" onFile={(f) => void media("banner", f)}>
              <ImagePlus className="size-4" /> {busy === "banner" ? "Enviando…" : "Trocar capa"}
            </FileButton>
          </div>
        </div>
      </Section>
      <Section title="Nome">
        <input className="field" value={f.name} maxLength={48} onChange={(e) => setF({ ...f, name: e.target.value })} />
      </Section>
      <Section title="Descrição" hint="Aparece no convite.">
        <textarea className="field min-h-[80px]" value={f.description} maxLength={200} onChange={(e) => setF({ ...f, description: e.target.value })} />
      </Section>
      <Section title="Cor do servidor" hint="Pinta os botões, links e destaques do app enquanto a turma está neste servidor.">
        <Swatches value={server.accent} colors={ACCENTS} round={false} onPick={(c) => void patch({ accent: c })} />
      </Section>
      <WelcomeLines server={server} onSave={(welcome_lines) => patch({ welcome_lines }).then(() => toast("Boas-vindas salvas."))} />
      <Section title="Hall da Fama" hint="Quantas pessoas diferentes precisam reagir (sem contar quem escreveu) para a mensagem entrar no Hall.">
        <div className="flex flex-wrap gap-1.5">
          {[1, 2, 3, 4, 5, 7, 10].map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => void patch({ hall_threshold: n })}
              className={`press h-9 min-w-9 rounded-[10px] px-3 text-[14px] font-semibold tabular-nums ${
                server.hall_threshold === n ? "bg-ember text-white" : "bg-cocoa-0 text-oat/70 hover:text-oat"
              }`}
            >
              {n}
            </button>
          ))}
        </div>
      </Section>
      <Section title="Hype" hint="O botão de hype chama todo mundo do servidor para a call. Aqui você escolhe de quanto em quanto tempo alguém pode chamar de novo.">
        <div className="flex flex-wrap gap-1.5">
          {(
            [
              [30, "30 s"],
              [60, "1 min"],
              [120, "2 min"],
              [300, "5 min"],
              [600, "10 min"],
              [1800, "30 min"],
              [0, "Desligado"],
            ] as const
          ).map(([n, label]) => (
            <button
              key={n}
              type="button"
              aria-pressed={(server.hype_cooldown ?? 120) === n}
              onClick={() => void patch({ hype_cooldown: n })}
              className={`press h-9 rounded-[10px] px-3 text-[14px] font-semibold ${
                (server.hype_cooldown ?? 120) === n ? "bg-ember text-white" : "bg-cocoa-0 text-oat/70 hover:text-oat"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </Section>
      {dirty && (
        <div className="flex justify-end gap-2 py-2">
          <button type="button" onClick={() => void patch(f).then(() => toast("Servidor salvo."))} className="btn-ember h-10 px-5 text-[14px]">
            Salvar alterações
          </button>
        </div>
      )}
      {owner && (
        <Section title="Zona de perigo">
          <button
            type="button"
            onClick={async () => {
              if (prompt(`Isso apaga ${server.name}, todos os canais e mensagens. Para confirmar, digite o nome do servidor:`) !== server.name) return;
              try {
                await api(`/servers/${server.id}`, { method: "DELETE" });
                closeModal();
                router.replace("/app");
              } catch (e) {
                toast(errorText(e));
              }
            }}
            className="press flex h-10 items-center gap-2 rounded-[12px] border border-rust/60 px-4 text-[14px] font-semibold text-[#ff8f92] hover:bg-rust hover:text-oat"
          >
            <Trash2 className="size-4" /> Apagar servidor
          </button>
        </Section>
      )}
    </div>
  );
}

function SoundsTab({ server, admin }: { server: Server; admin: boolean }) {
  const me = useStore((s) => s.me)!;
  const [name, setName] = useState("");
  const [emoji, setEmoji] = useState("🔊");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <div className="max-w-2xl">
      <H>Soundboard</H>
      <p className="-mt-3 mb-5 text-[14px] text-oat/55">Sons que qualquer um toca para todo mundo na call. Até 60 por servidor, 2 MB cada (até 8 segundos tocam).</p>
      <form
        className="rounded-[14px] bg-cocoa-3 p-4"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!file) return setError("Escolha um arquivo de som.");
          setBusy(true);
          setError("");
          try {
            await upload(`/servers/${server.id}/sounds`, file, { name, emoji });
            setName("");
            setFile(null);
          } catch (err) {
            setError(errorText(err));
          }
          setBusy(false);
        }}
      >
        <div className="flex flex-wrap gap-2">
          <input className="field !w-16 text-center text-[20px]" value={emoji} onChange={(e) => setEmoji(e.target.value.slice(-2))} aria-label="Emoji do som" />
          <input className="field min-w-[160px] flex-1" value={name} onChange={(e) => setName(e.target.value)} placeholder="Nome (ex.: bruh, risada)" maxLength={32} required />
          <FileButton
            accept="audio/*,.mp3,.ogg,.wav,.m4a,.webm"
            onFile={(f) => {
              setFile(f);
              if (!name) setName(f.name.replace(/\.[^.]+$/, "").slice(0, 32));
            }}
            className="btn-quiet h-[46px] px-3.5 text-[13.5px]"
          >
            <Upload className="size-4" /> {file ? file.name.slice(0, 18) : "Arquivo"}
          </FileButton>
          <button type="submit" disabled={busy} className="btn-ember h-[46px] px-4 text-[14px]">
            {busy ? "Enviando…" : "Adicionar"}
          </button>
        </div>
        <FormError>{error}</FormError>
      </form>
      <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-3">
        {server.sounds.map((s) => (
          <div key={s.id} className="group flex items-center gap-2 rounded-[12px] bg-cocoa-3 p-2.5">
            <button type="button" onClick={() => void new Audio(s.url).play()} aria-label={`Ouvir ${s.name}`} className="press grid size-9 shrink-0 place-items-center rounded-[10px] bg-cocoa-5 text-[18px]">
              {s.emoji || "🔊"}
            </button>
            <span className="min-w-0 flex-1 truncate text-[14px] font-medium">{s.name}</span>
            {(admin || s.uploader_id === me.id) && (
              <button
                type="button"
                onClick={() => void api(`/sounds/${s.id}`, { method: "DELETE" }).catch((e) => toast(errorText(e)))}
                aria-label={`Apagar ${s.name}`}
                className="press hidden size-7 place-items-center rounded-[8px] text-rust hover:bg-rust/15 group-hover:grid"
              >
                <Trash2 className="size-4" />
              </button>
            )}
          </div>
        ))}
      </div>
      {!server.sounds.length && <p className="mt-6 text-[14px] text-oat/45">Nenhum som ainda. Comece pelo clássico “bruh”.</p>}
    </div>
  );
}

function EmojisTab({ server, admin }: { server: Server; admin: boolean }) {
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  return (
    <div className="max-w-2xl">
      <H>Emojis do servidor</H>
      <p className="-mt-3 mb-5 text-[14px] text-oat/55">
        Use no chat com <code className="rounded bg-cocoa-0 px-1">:nome:</code>. PNG, GIF ou WebP de até 1 MB, animados também.
      </p>
      <div className="flex flex-wrap gap-2 rounded-[14px] bg-cocoa-3 p-4">
        <div className="relative min-w-[180px] flex-1">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-oat/35">:</span>
          <input className="field px-6" value={name} onChange={(e) => setName(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ""))} placeholder="nome_do_emoji" maxLength={32} />
          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-oat/35">:</span>
        </div>
        <FileButton
          accept="image/png,image/gif,image/webp,image/jpeg"
          className="btn-ember h-[46px] px-4 text-[14px]"
          onFile={async (f) => {
            setError("");
            const n = name || f.name.replace(/\.[^.]+$/, "").toLowerCase().replace(/[^a-z0-9_]/g, "_").slice(0, 32);
            try {
              await upload(`/servers/${server.id}/emojis`, f, { name: n });
              setName("");
            } catch (err) {
              setError(errorText(err));
            }
          }}
        >
          <Upload className="size-4" /> Subir emoji
        </FileButton>
        <FormError>{error}</FormError>
      </div>
      <div className="mt-5 grid grid-cols-3 gap-2 sm:grid-cols-4">
        {server.emojis.map((e) => (
          <div key={e.id} className="group flex items-center gap-2 rounded-[12px] bg-cocoa-3 p-2.5">
            <img src={e.url} alt={e.name} className="size-8 object-contain" />
            <span className="min-w-0 flex-1 truncate text-[13px]">:{e.name}:</span>
            {admin && (
              <button type="button" onClick={() => void api(`/emojis/${e.id}`, { method: "DELETE" }).catch((x) => toast(errorText(x)))} aria-label={`Apagar ${e.name}`} className="hidden text-rust group-hover:block">
                <Trash2 className="size-4" />
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function ChannelsTab({ server }: { server: Server }) {
  return (
    <div className="max-w-xl">
      <H>Canais</H>
      <div className="space-y-2">
        {server.channels.map((c) => (
          <ChannelRow key={c.id} server={server} id={c.id} name={c.name} topic={c.topic} type={c.type} limit={c.user_limit ?? 0} />
        ))}
      </div>
    </div>
  );
}

type TemplateChannel = {
  id: string;
  name: string;
  type: "text" | "voice";
  category: string;
  category_position: number;
  position: number;
  private: boolean;
  user_limit: number;
};

type TemplatePreview = { name: string; fingerprint: string; channels: TemplateChannel[] };

function DiscordTemplateTab({ server }: { server: Server }) {
  const [code, setCode] = useState("");
  const [preview, setPreview] = useState<TemplatePreview | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [mode, setMode] = useState<"add" | "replace">("add");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState("");
  const [error, setError] = useState("");
  const groups = preview ? Array.from(new Set(preview.channels.map((channel) => channel.category))) : [];

  async function load() {
    setBusy(true);
    setError("");
    setResult("");
    setPreview(null);
    try {
      const data = await api<TemplatePreview>(`/servers/${server.id}/discord-template/preview`, { json: { template: code } });
      setPreview(data);
      setSelected(data.channels.filter((channel) => !channel.private).map((channel) => channel.id));
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setBusy(false);
    }
  }

  async function runImport() {
    if (!preview || selected.length === 0) return;
    const confirmation = mode === "replace"
      ? `Substituir os ${server.channels.length} canais atuais de ${server.name}? A operação será recusada se houver mensagens, vínculos ou permissões próprias.`
      : `Adicionar ${selected.length} canais a ${server.name}?`;
    if (!confirm(confirmation)) return;
    setBusy(true);
    setError("");
    try {
      const outcome = await api<{ created: number; skipped: number }>(`/servers/${server.id}/discord-template/import`, {
        json: { template: code, selected, mode, fingerprint: preview.fingerprint },
      });
      setResult(`Criados ${outcome.created} canais. Já existentes ${outcome.skipped}.`);
      toast("Importação concluída.");
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-xl space-y-4">
      <H>Importar modelo do Discord</H>
      <p className="text-[13px] text-oat/60">Cole um link discord.new ou código. Categorias aparecem na prévia, mas os canais serão criados na lista do servidor.</p>
      <div className="flex gap-2">
        <input className="field flex-1" value={code} onChange={(event) => { setCode(event.target.value); setPreview(null); }} placeholder="https://discord.new/..." aria-label="Link ou código do modelo" />
        <button type="button" className="btn-ember px-4" disabled={busy || !code.trim()} onClick={() => void load()}>Ver prévia</button>
      </div>
      {preview && (
        <>
          <p className="text-[13px] text-oat/70">{preview.name} · {preview.channels.length} canais. Canais privados ficam bloqueados.</p>
          <div className="max-h-72 space-y-4 overflow-y-auto">
            {groups.map((category) => (
              <div key={category || "sem-categoria"}>
                <h3 className="mb-1 text-[13px] font-semibold text-oat">{category || "Sem categoria"}</h3>
                {preview.channels.filter((channel) => channel.category === category).map((channel) => (
                  <label key={channel.id} className="flex items-center gap-2 py-1 text-[13px] text-oat/75">
                    <input type="checkbox" disabled={channel.private} checked={selected.includes(channel.id)} onChange={(event) => setSelected((current) => event.target.checked ? [...current, channel.id] : current.filter((id) => id !== channel.id))} />
                    <span>{channel.type === "text" ? "#" : "🔊"} {channel.name}</span>
                    {channel.user_limit > 0 && <span>· limite {channel.user_limit}</span>}
                    {channel.private && <span className="text-rust">Privado no Discord</span>}
                  </label>
                ))}
              </div>
            ))}
          </div>
          <label className="flex items-center gap-2 text-[13px] text-oat">
            Modo
            <select className="field" value={mode} onChange={(event) => setMode(event.target.value as "add" | "replace")}>
              <option value="add">Adicionar sem duplicar</option>
              <option value="replace">Substituir canais vazios</option>
            </select>
          </label>
          <p className="text-[13px] text-oat/60">{selected.length} selecionados. {mode === "replace" ? `${server.channels.length} canais atuais serão verificados antes da substituição.` : "Canais existentes com o mesmo nome serão preservados."}</p>
          <button type="button" className="btn-ember px-4" disabled={busy || selected.length === 0} onClick={() => void runImport()}>{busy ? "Aguarde…" : "Confirmar importação"}</button>
        </>
      )}
      {error && <p role="alert" className="text-[13px] text-rust">{error}</p>}
      {result && <p role="status" className="text-[13px] text-oat">{result}</p>}
    </div>
  );
}

function ChannelRow({ server, id, name, topic, type, limit }: { server: Server; id: string; name: string; topic: string; type: "text" | "voice"; limit: number }) {
  const [f, setF] = useState({ name, topic, user_limit: limit });
  const dirty = f.name !== name || f.topic !== topic || f.user_limit !== limit;
  return (
    <div className="rounded-[12px] bg-cocoa-3 p-3">
      <div className="flex items-center gap-2">
        {type === "text" ? <Hash className="size-4 text-oat/45" /> : <Volume2 className="size-4 text-oat/45" />}
        <input className="field h-9 flex-1 !py-0" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} aria-label="Nome do canal" />
        <button
          type="button"
          onClick={async () => {
            if (!confirm(`Apagar ${type === "text" ? "#" : ""}${name}? As mensagens vão junto.`)) return;
            await api(`/channels/${id}`, { method: "DELETE" }).catch((e) => toast(errorText(e)));
          }}
          aria-label="Apagar canal"
          className="press grid size-9 place-items-center rounded-[10px] text-rust hover:bg-rust/15"
        >
          <Trash2 className="size-4" />
        </button>
      </div>
      {type === "text" && <input className="field mt-2 h-9 !py-0 text-[13.5px]" value={f.topic} placeholder="Tópico do canal" onChange={(e) => setF({ ...f, topic: e.target.value })} />}
      {type === "voice" && (
        <label className="mt-2 flex items-center gap-2 text-[13px] text-oat/60">
          Limite de pessoas
          <input
            type="number"
            min={0}
            max={99}
            className="field h-8 !w-16 !py-0 text-center text-[13.5px]"
            value={f.user_limit}
            onChange={(e) => setF({ ...f, user_limit: Math.max(0, Math.min(99, Number(e.target.value) || 0)) })}
            aria-label={`Limite de pessoas em ${name}`}
          />
          <span className="text-[12px] text-oat/40">0 = sem limite. Admins e quem modera a call entram mesmo cheia.</span>
        </label>
      )}
      {dirty && (
        <button type="button" onClick={() => void api(`/channels/${id}`, { method: "PATCH", json: f }).catch((e) => toast(errorText(e)))} className="btn-ember mt-2 h-8 px-3 text-[13px]">
          Salvar
        </button>
      )}
      <ChannelAccess server={server} channelId={id} />
    </div>
  );
}

function MembersTab({ server, owner }: { server: Server; owner: boolean }) {
  const me = useStore((s) => s.me)!;
  return (
    <div className="max-w-2xl">
      <H>Membros</H>
      <ul className="divide-y divide-oat/[0.06]">
        {server.members.map((m) => (
          <li key={m.user.id} className="flex items-center gap-3 py-2.5">
            <Avatar name={m.user.display_name} avatar={m.user.avatar} accent={m.user.accent} size={36} />
            <span className="min-w-0 flex-1">
              <span className="block truncate font-semibold">{m.user.display_name}</span>
              <span className="text-[12.5px] text-oat/45">@{m.user.username}</span>
              <MemberRoles server={server} member={m} />
              {m.role !== "member" && (m.roles?.length ?? 0) > 0 && (
                <span className="mt-1 block text-[11.5px] text-oat/40">{m.role === "owner" ? "Dono" : "Admin"}: pode tudo, então os limites dos cargos não valem para ele.</span>
              )}
            </span>
            {m.role === "owner" ? (
              <span className="text-[13px] text-honey">Dono</span>
            ) : owner ? (
              <select
                value={m.role}
                onChange={async (e) => {
                  const role = e.target.value;
                  if (role === "owner" && !confirm(`Passar a posse do servidor para ${m.user.display_name}? Você vira admin.`)) return;
                  await api(`/servers/${server.id}/members/${m.user.id}`, { method: "PATCH", json: { role } }).catch((x) => toast(errorText(x)));
                }}
                className="rounded-[8px] bg-cocoa-0 px-2 py-1.5 text-[13px] outline-none"
              >
                <option value="member">Membro</option>
                <option value="admin">Admin</option>
                <option value="owner">Passar a posse</option>
              </select>
            ) : (
              <span className="text-[13px] text-oat/55">{m.role === "admin" ? "Admin" : "Membro"}</span>
            )}
            {m.user.id !== me.id && m.role !== "owner" && (owner || m.role === "member") && (
              <button
                type="button"
                onClick={async () => {
                  if (!confirm(`Tirar ${m.user.display_name} do servidor?`)) return;
                  await api(`/servers/${server.id}/members/${m.user.id}`, { method: "DELETE" }).catch((x) => toast(errorText(x)));
                }}
                className="press rounded-[8px] px-2 py-1.5 text-[13px] text-[#ff8f92] hover:bg-rust hover:text-oat"
              >
                Remover
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
