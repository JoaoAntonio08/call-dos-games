"use client";

import { useParams } from "next/navigation";
import { create } from "zustand";

/** Estado de interface que não vai para o servidor: modais, cartão de perfil, painel de membros. */
interface UI {
  profile: { id: string; rect: DOMRect; serverId?: string } | null;
  /** menu do botão direito numa pessoa */
  userMenu: { id: string; x: number; y: number; serverId?: string } | null;
  modal:
    | { kind: "settings"; tab?: string }
    | { kind: "server-settings"; serverId: string; tab?: string }
    | { kind: "create-server" }
    | { kind: "invite"; serverId: string }
    | { kind: "create-channel"; serverId: string; type: "text" | "voice" }
    | null;
  showMembers: boolean;
  navOpen: boolean;
  /** chat ao lado da call */
  callChat: boolean;
  /** esconde servidores e canais para a call ocupar a tela */
  focus: boolean;
  toast: { id: number; text: string } | null;
}

function remembered(key: string, fallback: boolean) {
  try {
    const v = localStorage.getItem(`cdg:ui:${key}`);
    return v === null ? fallback : v === "1";
  } catch {
    return fallback;
  }
}

export const useUI = create<UI>(() => ({
  profile: null,
  userMenu: null,
  modal: null,
  showMembers: true,
  navOpen: false,
  toast: null,
  callChat: typeof window !== "undefined" && remembered("callChat", false),
  focus: false,
}));

/** Liga/desliga uma preferência de tela e lembra dela neste navegador. */
export function toggleUI(key: "callChat" | "focus") {
  const next = !useUI.getState()[key];
  useUI.setState({ [key]: next } as Partial<UI>);
  try {
    localStorage.setItem(`cdg:ui:${key}`, next ? "1" : "0");
  } catch {
    /* sem armazenamento */
  }
}

export const openProfile = (id: string, el: HTMLElement, serverId?: string) =>
  useUI.setState({ profile: { id, rect: el.getBoundingClientRect(), serverId } });
export const closeProfile = () => useUI.setState({ profile: null });
/** Botão direito (ou segurar o dedo, no celular) numa pessoa. */
export function openUserMenu(e: React.MouseEvent, id: string, serverId?: string) {
  e.preventDefault();
  e.stopPropagation();
  useUI.setState({ userMenu: { id, x: e.clientX, y: e.clientY, serverId }, profile: null });
}
export const closeUserMenu = () => useUI.setState({ userMenu: null });
export const openModal = (modal: UI["modal"]) => useUI.setState({ modal, profile: null });
export const closeModal = () => useUI.setState({ modal: null });

let toastN = 0;
export function toast(text: string) {
  const id = ++toastN;
  useUI.setState({ toast: { id, text } });
  window.setTimeout(() => {
    if (useUI.getState().toast?.id === id) useUI.setState({ toast: null });
  }, 4200);
}

export type ServerPage = "hall" | "lista" | "noites";
export type Route =
  | { kind: "home" }
  | { kind: "dm"; id: string }
  | { kind: "server"; serverId: string; channelId: string | null; page?: ServerPage };

export function useRoute(): Route {
  const params = useParams<{ slug?: string[] }>();
  const slug = params.slug ?? [];
  if (slug[0] === "dm" && slug[1]) return { kind: "dm", id: slug[1] };
  if (slug[0] === "s" && slug[1]) {
    if (slug[2] === "hall" || slug[2] === "lista" || slug[2] === "noites") return { kind: "server", serverId: slug[1], channelId: null, page: slug[2] };
    return { kind: "server", serverId: slug[1], channelId: slug[2] ?? null };
  }
  return { kind: "home" };
}

// só em desenvolvimento: deixa o estado da tela à mão para os testes automáticos
if (typeof window !== "undefined" && process.env.NODE_ENV !== "production") {
  (window as unknown as { __cdgui: typeof useUI }).__cdgui = useUI;
}
