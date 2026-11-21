// Aparência do app, escolhida por cada pessoa (fica no navegador):
// - estilo "estilizado" (padrão): vidro translúcido tingido, fundo com brilho suave e animação de entrada
// - estilo "normal": o visual sólido de sempre, entrada rápida
// - cor do vidro: a do servidor aberto, a do seu perfil ou uma escolhida
import { create } from "zustand";

export type LookStyle = "estilizado" | "normal";
export type LookTint = "servidor" | "perfil" | `#${string}`;

export interface Look {
  style: LookStyle;
  tint: LookTint;
  /** animação de entrada ao abrir o app */
  intro: boolean;
}

const KEY = "cdg:aparencia";
export const DEFAULT_LOOK: Look = { style: "estilizado", tint: "servidor", intro: true };

function read(): Look {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT_LOOK;
    const v = JSON.parse(raw) as Partial<Look>;
    return {
      style: v.style === "normal" ? "normal" : "estilizado",
      tint: v.tint === "perfil" || (typeof v.tint === "string" && /^#[0-9a-f]{6}$/i.test(v.tint)) ? (v.tint as LookTint) : "servidor",
      intro: v.intro !== false,
    };
  } catch {
    return DEFAULT_LOOK;
  }
}

export const useLook = create<Look & { set: (p: Partial<Look>) => void; replay: number; playIntro: () => void }>((set, get) => ({
  ...(typeof window === "undefined" ? DEFAULT_LOOK : read()),
  set: (p) => {
    set(p);
    const { style, tint, intro } = get();
    try {
      localStorage.setItem(KEY, JSON.stringify({ style, tint, intro }));
    } catch {
      /* sem armazenamento: vale só até fechar */
    }
  },
  /** muda quando alguém pede "ver a animação de novo" nas configurações */
  replay: 0,
  playIntro: () => set((s) => ({ replay: s.replay + 1 })),
}));

const BLURPLE = "#5865f2";

/** A cor que tinge o vidro: a escolhida, a do perfil ou a do servidor aberto. */
export function tintColor(tint: LookTint, serverAccent?: string, profileAccent?: string): string {
  const ok = (c?: string) => (c && /^#[0-9a-f]{6}$/i.test(c) ? c : undefined);
  if (tint === "perfil") return ok(profileAccent) ?? BLURPLE;
  if (tint === "servidor") return ok(serverAccent) ?? BLURPLE;
  return ok(tint) ?? BLURPLE;
}

/** Quem pediu ao sistema menos movimento não vê animação de entrada. */
export function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}
