"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import type { Media, Presence } from "@/lib/types";

/* ------------------------------------------------------------------ */
/* imagem que pode ser animada (GIF/WebP)                              */
/* ------------------------------------------------------------------ */

/**
 * Mostra o quadro parado e anima no hover do `.group` mais próximo.
 * `play` força a animação (cartão de perfil aberto, configurações).
 */
export function AnimImg({ media, alt, className = "", play }: { media: Media; alt: string; className?: string; play?: boolean }) {
  if (!media.animated) return <img src={media.url} alt={alt} className={className} draggable={false} />;
  return (
    <span className={`anim-swap relative block ${play ? "playing" : ""} ${className}`}>
      <img src={media.still} alt={alt} className="still-when-anim size-full object-cover" draggable={false} />
      <img src={media.url} alt="" aria-hidden className="anim absolute inset-0 size-full object-cover" draggable={false} loading="lazy" />
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* avatar                                                              */
/* ------------------------------------------------------------------ */

/** Cor de fundo estável para quem não tem foto, puxada da cor de destaque do perfil. */
function initialsOf(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  return (parts[0][0] + (parts[1]?.[0] ?? "")).toUpperCase();
}

export function Avatar({
  name,
  avatar,
  accent = "#5865f2",
  size = 40,
  status,
  ring,
  play,
  className = "",
}: {
  name: string;
  avatar?: Media | null;
  accent?: string;
  size?: number;
  status?: Presence;
  ring?: string;
  play?: boolean;
  className?: string;
}) {
  const dot = Math.max(10, Math.round(size * 0.3));
  return (
    <span className={`relative inline-block shrink-0 ${className}`} style={{ width: size, height: size }}>
      <span
        className="block size-full overflow-hidden rounded-full"
        style={{
          background: avatar ? "var(--color-cocoa-4)" : `color-mix(in srgb, ${accent} 75%, #18191c)`,
          boxShadow: ring ? `0 0 0 2px var(--color-cocoa-2), 0 0 0 4px ${ring}` : undefined,
          transition: "box-shadow .15s ease",
        }}
      >
        {avatar ? (
          <AnimImg media={avatar} alt={name} className="size-full object-cover" play={play} />
        ) : (
          <span
            className="grid size-full place-items-center font-display text-oat"
            style={{ fontSize: size * 0.42, lineHeight: 1, fontWeight: 560 }}
            aria-label={name}
          >
            {initialsOf(name)}
          </span>
        )}
      </span>
      {status && (
        <StatusDot
          status={status}
          className="absolute"
          style={{ width: dot, height: dot, right: -2, bottom: -2, boxShadow: "0 0 0 3px var(--dot-ring, var(--color-cocoa-2))" }}
        />
      )}
    </span>
  );
}

const STATUS_LABEL: Record<Presence, string> = {
  online: "Online",
  idle: "Ausente",
  dnd: "Não perturbe",
  invisible: "Invisível",
  offline: "Offline",
};
export const statusLabel = (s: Presence) => STATUS_LABEL[s];

/** Bolinha de presença. Cada estado tem forma própria, não só cor. */
export function StatusDot({ status, className = "", style }: { status: Presence; className?: string; style?: React.CSSProperties }) {
  const base = "inline-block rounded-full";
  if (status === "online") return <span title={STATUS_LABEL[status]} className={`${base} bg-moss ${className}`} style={style} />;
  if (status === "idle")
    return (
      <span title={STATUS_LABEL[status]} className={`${base} ${className}`} style={{ ...style, background: "radial-gradient(circle at 30% 30%, transparent 32%, var(--color-honey) 33%)" }} />
    );
  if (status === "dnd")
    return (
      <span title={STATUS_LABEL[status]} className={`${base} grid place-items-center bg-rust ${className}`} style={style}>
        <span className="block h-[22%] w-[55%] rounded-full bg-cocoa-2" />
      </span>
    );
  return (
    <span title={STATUS_LABEL[status]} className={`${base} grid place-items-center bg-cocoa-5 ${className}`} style={style}>
      <span className="block size-[45%] rounded-full bg-cocoa-2" />
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* ícone de servidor                                                   */
/* ------------------------------------------------------------------ */

export function ServerIcon({ name, icon, accent, size = 48, className = "" }: { name: string; icon?: Media | null; accent?: string; size?: number; className?: string }) {
  const letters = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 3)
    .map((w) => w[0])
    .join("")
    .toUpperCase();
  return (
    <span
      className={`group/icon block shrink-0 overflow-hidden ${className}`}
      style={{ width: size, height: size, borderRadius: size * 0.32, background: icon ? "var(--color-cocoa-4)" : accent ?? "var(--color-cocoa-4)" }}
    >
      {icon ? (
        <AnimImg media={icon} alt={name} className="size-full object-cover" />
      ) : (
        <span className="grid size-full place-items-center font-display text-white" style={{ fontSize: size * (letters.length > 2 ? 0.3 : 0.38), fontWeight: 600 }}>
          {letters || "?"}
        </span>
      )}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* modal                                                               */
/* ------------------------------------------------------------------ */

export function Modal({
  open,
  onClose,
  children,
  label,
  className = "",
}: {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  label: string;
  className?: string;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open || typeof document === "undefined") return null;
  return createPortal(
    <div className="fixed inset-0 z-50 grid place-items-center p-3" role="presentation">
      <div className="absolute inset-0 bg-cocoa-0/75" onClick={onClose} />
      <div role="dialog" aria-modal aria-label={label} className={`pop-in glass-float relative max-h-[calc(100svh-24px)] overflow-y-auto rounded-[18px] bg-cocoa-2 ${className}`}>
        {children}
      </div>
    </div>,
    document.body,
  );
}

export function CloseButton({ onClick, className = "" }: { onClick: () => void; className?: string }) {
  return (
    <button type="button" onClick={onClick} aria-label="Fechar" className={`press grid size-8 place-items-center rounded-full text-oat/60 hover:bg-cocoa-4 hover:text-oat ${className}`}>
      <X className="size-4" />
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* popover ancorado num elemento                                       */
/* ------------------------------------------------------------------ */

export function Popover({
  anchor,
  onClose,
  children,
  side = "right",
  className = "",
}: {
  anchor: DOMRect | null;
  onClose: () => void;
  children: React.ReactNode;
  side?: "right" | "left" | "top" | "bottom";
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !anchor) return;
    const place = () => {
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      const gap = 10;
      let left = side === "right" ? anchor.right + gap : side === "left" ? anchor.left - w - gap : anchor.left;
      let top = side === "top" ? anchor.top - h - gap : side === "bottom" ? anchor.bottom + gap : anchor.top;
      left = Math.max(8, Math.min(left, window.innerWidth - w - 8));
      top = Math.max(8, Math.min(top, window.innerHeight - h - 8));
      setPos((p) => (p && p.left === left && p.top === top ? p : { left, top }));
    };
    place();
    // o conteúdo pode crescer depois (perfil completo chega da API): reposiciona para não sair da tela
    const ro = new ResizeObserver(place);
    ro.observe(el);
    return () => ro.disconnect();
  }, [anchor, side]);

  useEffect(() => {
    if (!anchor) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    const t = window.setTimeout(() => window.addEventListener("mousedown", onDown), 0);
    window.addEventListener("keydown", onKey);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [anchor, onClose]);

  if (!anchor || typeof document === "undefined") return null;
  return createPortal(
    <div
      ref={ref}
      className={`pop-in fixed z-50 ${className}`}
      style={{ left: pos?.left ?? -9999, top: pos?.top ?? -9999, visibility: pos ? "visible" : "hidden", maxHeight: "calc(100svh - 16px)", overflowY: "auto" }}
    >
      {children}
    </div>,
    document.body,
  );
}

/* ------------------------------------------------------------------ */
/* diversos                                                            */
/* ------------------------------------------------------------------ */

export function Toggle({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative h-6 w-10 shrink-0 rounded-full transition-colors disabled:cursor-not-allowed ${checked ? "bg-ember" : "bg-cocoa-5"}`}
    >
      <span className={`absolute left-0 top-1 size-4 rounded-full bg-oat transition-transform duration-200 ${checked ? "translate-x-5" : "translate-x-1"}`} />
    </button>
  );
}

export function Tip({ children }: { children: React.ReactNode }) {
  return <p className="mt-2 text-[12.5px] leading-relaxed text-oat/55">{children}</p>;
}

export function FormError({ children }: { children: React.ReactNode }) {
  if (!children) return null;
  return (
    <p role="alert" className="mt-3 rounded-[10px] bg-rust/15 px-3 py-2 text-[13px] text-[#ffb1b3]">
      {children}
    </p>
  );
}

/** Contorno de seção nas telas de ajustes. */
export function Section({ title, children, hint }: { title: string; children: React.ReactNode; hint?: React.ReactNode }) {
  return (
    <section className="border-t border-oat/[0.08] py-5 first:border-t-0 first:pt-0">
      <h3 className="label text-oat/50">{title}</h3>
      <div className="mt-3">{children}</div>
      {hint && <Tip>{hint}</Tip>}
    </section>
  );
}

export function useAnchor<T extends HTMLElement>() {
  const [rect, setRect] = useState<DOMRect | null>(null);
  return {
    rect,
    open: (el: T | null) => setRect(el ? el.getBoundingClientRect() : null),
    close: () => setRect(null),
  };
}
