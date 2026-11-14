"use client";

import { useParams } from "next/navigation";
import { create } from "zustand";

/** Estado de interface que não vai para o servidor: modais, cartão de perfil, painel de membros. */
interface UI {
  profile: { id: string; rect: DOMRect; serverId?: string } | null;
  modal:
    | { kind: "settings"; tab?: string }
    | { kind: "server-settings"; serverId: string; tab?: string }
    | { kind: "create-server" }
    | { kind: "invite"; serverId: string }
    | { kind: "create-channel"; serverId: string; type: "text" | "voice" }
    | null;
  showMembers: boolean;
  navOpen: boolean;
  toast: { id: number; text: string } | null;
}

export const useUI = create<UI>(() => ({ profile: null, modal: null, showMembers: true, navOpen: false, toast: null }));

export const openProfile = (id: string, el: HTMLElement, serverId?: string) =>
  useUI.setState({ profile: { id, rect: el.getBoundingClientRect(), serverId } });
export const closeProfile = () => useUI.setState({ profile: null });
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

export type ServerPage = "hall" | "lista";
export type Route =
  | { kind: "home" }
  | { kind: "dm"; id: string }
  | { kind: "server"; serverId: string; channelId: string | null; page?: ServerPage };

export function useRoute(): Route {
  const params = useParams<{ slug?: string[] }>();
  const slug = params.slug ?? [];
  if (slug[0] === "dm" && slug[1]) return { kind: "dm", id: slug[1] };
  if (slug[0] === "s" && slug[1]) {
    if (slug[2] === "hall" || slug[2] === "lista") return { kind: "server", serverId: slug[1], channelId: null, page: slug[2] };
    return { kind: "server", serverId: slug[1], channelId: slug[2] ?? null };
  }
  return { kind: "home" };
}
