"use client";

import { Headphones, HeadphoneOff, Mic, MicOff, MonitorUp, PhoneOff, Settings, Signal } from "lucide-react";
import Link from "next/link";
import { api } from "@/lib/api";
import { useStore } from "@/lib/store";
import { openModal, openProfile } from "@/lib/ui";
import { useVoice } from "@/lib/voice";
import type { Presence } from "@/lib/types";
import { Avatar, Popover, StatusDot, statusLabel, useAnchor } from "./bits";

/* ------------------------------------------------------------------ */
/* barra de quem está logado (pé da coluna)                            */
/* ------------------------------------------------------------------ */

export function UserBar() {
  const me = useStore((s) => s.me)!;
  const v = useVoice();
  const status = useAnchor<HTMLButtonElement>();
  const local = v.call.peers.find((p) => p.isLocal);
  const inCall = !!v.channelId;
  const micOn = inCall ? !!local?.micOn || (v.prefs.ptt && v.pttDown) : !v.prefs.startMuted;

  async function setStatus(s: Presence) {
    status.close();
    useStore.setState((st) => ({ me: st.me ? { ...st.me, status: s } : st.me }));
    await api("/me", { method: "PATCH", json: { status: s } }).catch(() => {});
  }

  return (
    <div className="flex h-[60px] shrink-0 items-center gap-1 bg-cocoa-1/80 px-2" style={{ ["--dot-ring" as string]: "#1e1916" }}>
      <button
        type="button"
        onClick={(e) => status.open(e.currentTarget)}
        className="group flex min-w-0 flex-1 items-center gap-2.5 rounded-[10px] px-1.5 py-1 text-left hover:bg-cocoa-3"
        aria-label="Seu status"
      >
        <Avatar name={me.display_name} avatar={me.avatar} accent={me.accent} size={36} status={me.status} />
        <span className="min-w-0">
          <span className="block truncate text-[14px] font-semibold leading-tight">{me.display_name}</span>
          <span className="block truncate text-[12px] leading-tight text-oat/45">{me.custom_status || `@${me.username}`}</span>
        </span>
      </button>

      <BarButton
        label={v.prefs.ptt && inCall ? `Apertar para falar (${keyName(v.prefs.pttKey)})` : micOn ? "Desligar microfone" : "Ligar microfone"}
        off={!micOn}
        onClick={() => {
          if (inCall && !v.prefs.ptt) void v.call.toggleMic();
          else if (!inCall) v.setPrefs({ startMuted: !v.prefs.startMuted });
        }}
      >
        {micOn ? <Mic /> : <MicOff />}
      </BarButton>
      <BarButton label={v.deaf ? "Voltar a ouvir" : "Silenciar tudo"} off={v.deaf} onClick={() => v.setDeaf(!v.deaf)}>
        {v.deaf ? <HeadphoneOff /> : <Headphones />}
      </BarButton>
      <BarButton label="Configurações" onClick={() => openModal({ kind: "settings" })}>
        <Settings className="transition-transform duration-500 group-hover/b:rotate-90" />
      </BarButton>

      <Popover anchor={status.rect} onClose={status.close} side="top" className="w-[250px]">
        <div className="rounded-[14px] bg-cocoa-0 p-1.5">
          <button
            type="button"
            onClick={(e) => {
              status.close();
              openProfile(me.id, e.currentTarget);
            }}
            className="w-full rounded-[9px] px-2.5 py-2 text-left text-[14px] font-semibold hover:bg-cocoa-4"
          >
            Ver meu perfil
          </button>
          <div className="my-1 h-px bg-oat/10" />
          {(["online", "idle", "dnd", "invisible"] as Presence[]).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => void setStatus(s)}
              className={`flex w-full items-center gap-3 rounded-[9px] px-2.5 py-2 text-left text-[14px] hover:bg-cocoa-4 ${me.status === s ? "text-oat" : "text-oat/70"}`}
            >
              <StatusDot status={s} className="size-3" style={{ ["--dot-ring" as string]: "transparent" }} />
              <span className="flex-1">{statusLabel(s)}</span>
              {s === "invisible" && <span className="text-[11.5px] text-oat/40">aparece offline</span>}
            </button>
          ))}
          <div className="my-1 h-px bg-oat/10" />
          <button
            type="button"
            onClick={() => {
              status.close();
              openModal({ kind: "settings", tab: "perfil" });
            }}
            className="w-full rounded-[9px] px-2.5 py-2 text-left text-[13.5px] text-oat/70 hover:bg-cocoa-4 hover:text-oat"
          >
            {me.custom_status ? "Trocar a frase de status" : "Escrever uma frase de status"}
          </button>
        </div>
      </Popover>
    </div>
  );
}

export function keyName(code: string) {
  if (code.startsWith("Key")) return code.slice(3);
  if (code.startsWith("Digit")) return code.slice(5);
  return { Space: "Espaço", Backquote: "`", ShiftLeft: "Shift", ControlLeft: "Ctrl", AltLeft: "Alt", CapsLock: "Caps", Tab: "Tab" }[code] ?? code;
}

function BarButton({ label, off, onClick, children }: { label: string; off?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      aria-pressed={off === undefined ? undefined : !off}
      className={`press group/b grid size-9 shrink-0 place-items-center rounded-[9px] [&_svg]:size-[18px] ${off ? "text-rust hover:bg-rust/15" : "text-oat/65 hover:bg-cocoa-4 hover:text-oat"}`}
    >
      {children}
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* faixa "conectado na call", logo acima                              */
/* ------------------------------------------------------------------ */

export function VoiceBar() {
  const v = useVoice();
  const servers = useStore((s) => s.servers);
  const dms = useStore((s) => s.dms);
  if (!v.channelId && !v.joining) return null;
  const cid = v.channelId ?? v.joining!;
  let label = "Conversa";
  let where = "";
  let href = `/app/dm/${cid}`;
  for (const s of Object.values(servers)) {
    const c = s.channels.find((x) => x.id === cid);
    if (c) {
      label = c.name;
      where = s.name;
      href = `/app/s/${s.id}/${c.id}`;
    }
  }
  const dm = dms.find((d) => d.id === cid);
  if (dm) {
    label = dm.recipients.map((u) => u.display_name).join(", ");
    where = "Chamada";
  }
  const local = v.call.peers.find((p) => p.isLocal);
  const status = v.joining ? "Conectando…" : v.call.status === "reconnecting" ? "Reconectando…" : "Na call";

  return (
    <div className="shrink-0 border-t border-oat/[0.06] bg-cocoa-1/50 px-3 py-2.5">
      <div className="flex items-center gap-2">
        <Signal className={`size-4 ${v.joining || v.call.status === "reconnecting" ? "text-honey" : "text-moss"}`} />
        <div className="min-w-0 flex-1">
          <p className={`text-[13px] font-bold ${v.joining || v.call.status === "reconnecting" ? "text-honey" : "text-moss"}`}>{status}</p>
          <Link href={href} className="block truncate text-[12px] text-oat/55 hover:text-oat hover:underline">
            {label}
            {where && ` / ${where}`}
          </Link>
        </div>
        <button type="button" onClick={() => void v.leave()} aria-label="Sair da call" title="Sair da call" className="press grid size-8 place-items-center rounded-[9px] text-oat/70 hover:bg-rust hover:text-oat">
          <PhoneOff className="size-[17px]" />
        </button>
      </div>
      {local?.screen && (
        <p className="mt-1.5 flex items-center gap-1.5 text-[12px] font-semibold text-ember-2">
          <MonitorUp className="size-3.5" /> Você está transmitindo
        </p>
      )}
      {v.prefs.ptt && v.channelId && (
        <p className={`mt-1.5 text-[11.5px] ${v.pttDown ? "font-bold text-moss" : "text-oat/45"}`}>
          {v.pttDown ? "Falando…" : `Segure ${keyName(v.prefs.pttKey)} para falar`}
        </p>
      )}
    </div>
  );
}
