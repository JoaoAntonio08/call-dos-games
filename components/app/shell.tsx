"use client";

import { PersistentPlayer } from "./music-player";
import { MessageAlerts } from "./avisos";
import { ContextMenuHost } from "./context-menu";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useStore } from "@/lib/store";
import { toast, useRoute, useUI } from "@/lib/ui";
import { accentVars } from "@/lib/theme";
import { tintColor, useLook } from "@/lib/aparencia";
import { ServerRail } from "./rail";
import { HomeSidebar, ServerSidebar } from "./sidebars";
import { UserBar, VoiceBar } from "./user-bar";
import { ChatView } from "./chat";
import { FriendsView } from "./friends";
import { VoiceView } from "./voice-view";
import { HallView } from "./hall";
import { ShowsView } from "./shows";
import { MemberList } from "./members";
import { ProfilePopover } from "./profile";
import { UserMenu } from "./user-menu";
import { UpdateBanner } from "./update-banner";
import { HypeAlert } from "./hype";
import { NoiteAlert, NoitesView } from "./noites";
import { RetroView } from "./retro";
import { GameReporter } from "./jogo-app";
import { Modals } from "./modals";

export function Shell() {
  const route = useRoute();
  const router = useRouter();
  const servers = useStore((s) => s.servers);
  const dms = useStore((s) => s.dms);
  const connected = useStore((s) => s.connected);
  const navOpen = useUI((s) => s.navOpen);
  const focusOn = useUI((s) => s.focus);
  const showMembers = useUI((s) => s.showMembers);
  const toastMsg = useUI((s) => s.toast);
  // conquista liberada (o servidor avisa quando a pessoa passa de uma etapa)
  useEffect(() => {
    const on = (e: Event) => {
      const d = (e as CustomEvent<{ label: string }>).detail;
      toast(`🏆 Conquista liberada: ${d.label}. Escolha o que mostrar em Configurações → Perfil.`);
    };
    window.addEventListener("cdg:conquista", on);
    return () => window.removeEventListener("cdg:conquista", on);
  }, []);

  const server = route.kind === "server" ? servers[route.serverId] : undefined;
  const channel = server && route.kind === "server" ? server.channels.find((c) => c.id === route.channelId) : undefined;
  const dm = route.kind === "dm" ? dms.find((d) => d.id === route.id) : undefined;
  const page = route.kind === "server" ? route.page : undefined;

  // servidor sem canal na rota: abre o primeiro canal de texto (ou o último visitado)
  useEffect(() => {
    if (route.kind !== "server") return;
    if (!server) {
      if (Object.keys(servers).length || route.serverId) router.replace("/app");
      return;
    }
    if (!channel && !route.page) {
      let last: string | null = null;
      try {
        last = localStorage.getItem(`cdg:last:${server.id}`);
      } catch {
        /* sem armazenamento */
      }
      const target = server.channels.find((c) => c.id === last) ?? server.channels.find((c) => c.type === "text") ?? server.channels[0];
      if (target) router.replace(`/app/s/${server.id}/${target.id}`);
    } else if (channel) {
      try {
        localStorage.setItem(`cdg:last:${server.id}`, channel.id);
      } catch {
        /* sem armazenamento */
      }
    }
  }, [route, server, channel, servers, router]);

  useEffect(() => {
    if (route.kind === "dm" && !dm && dms.length >= 0) {
      const t = window.setTimeout(() => {
        if (!useStore.getState().dms.some((d) => d.id === route.id)) router.replace("/app");
      }, 1500);
      return () => window.clearTimeout(t);
    }
  }, [route, dm, dms.length, router]);

  // fecha a gaveta (celular) ao navegar
  useEffect(() => {
    useUI.setState({ navOpen: false });
  }, [route.kind, route.kind === "server" ? (route.channelId ?? route.page) : route.kind === "dm" ? route.id : ""]);

  // cor do servidor tinge o app inteiro (inclusive modais e cartões, que abrem fora desta árvore)
  const tint = server?.accent;
  useEffect(() => {
    const vars = accentVars(tint) as Record<string, string> | undefined;
    if (!vars) return;
    const root = document.documentElement.style;
    for (const [k, v] of Object.entries(vars)) root.setProperty(k, v);
    return () => {
      for (const k of Object.keys(vars)) root.removeProperty(k);
    };
  }, [tint]);

  // aparência: estilizado (vidro tingido) ou normal; a cor do vidro é a escolhida, a do perfil ou a do servidor
  const lookStyle = useLook((s) => s.style);
  const lookTint = useLook((s) => s.tint);
  const myAccent = useStore((s) => s.me?.accent);
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.look = lookStyle === "estilizado" ? "glass" : "plain";
    root.style.setProperty("--glass-tint", tintColor(lookTint, tint, myAccent));
  }, [lookStyle, lookTint, tint, myAccent]);

  // título da aba
  useEffect(() => {
    document.title = channel
      ? `${channel.type === "text" ? "#" : ""}${channel.name} · ${server?.name}`
      : page && server
        ? `${page === "hall" ? "Hall da Fama" : page === "noites" ? "Noite da turma" : page === "retro" ? "Retrospectiva" : "Onde paramos"} · ${server.name}`
      : dm
        ? `${dm.recipients.map((u) => u.display_name).join(", ")} · Call dos Games`
        : "Call dos Games";
  }, [channel, server?.name, dm, page]);

  let main: React.ReactNode = <FriendsView />;
  if (route.kind === "dm" && dm) main = <ChatView channelId={dm.id} dm={dm} />;
  if (channel?.type === "text") main = <ChatView channelId={channel.id} server={server} channel={channel} />;
  if (channel?.type === "voice" && server) main = <VoiceView channel={channel} server={server} />;
  if (route.kind === "server" && !channel) main = <div className="flex-1 bg-cocoa-3" />;
  if (server && page === "hall") main = <HallView server={server} />;
  if (server && page === "lista") main = <ShowsView server={server} />;
  if (server && page === "noites") main = <NoitesView server={server} />;
  if (server && page === "retro") main = <RetroView server={server} />;

  const members = server && channel?.type === "text" && showMembers;
  // modo foco só vale na tela da call
  const focus = focusOn && channel?.type === "voice";

  return (
    <div className="flex h-svh overflow-hidden bg-cocoa-1">
      {/* navegação: fixa no desktop, gaveta no celular */}
      <div
        className={`fixed inset-y-0 left-0 z-40 flex transition-transform duration-200 md:static md:translate-x-0 ${navOpen ? "translate-x-0" : "-translate-x-full"} ${focus ? "md:hidden" : ""}`}
      >
        <ServerRail />
        <div className="flex w-[248px] flex-col bg-cocoa-2">
          {server ? <ServerSidebar server={server} activeId={channel?.id ?? null} page={page} /> : <HomeSidebar activeDm={dm?.id ?? null} />}
          <VoiceBar />
          <UserBar />
        </div>
      </div>
      {navOpen && <div className="fixed inset-0 z-30 bg-cocoa-0/60 md:hidden" onClick={() => useUI.setState({ navOpen: false })} />}

      <main className="flex min-w-0 flex-1 flex-col bg-cocoa-3">
        <UpdateBanner />
        {!connected && (
          <div className="bg-honey/90 px-4 py-1.5 text-center text-[12.5px] font-semibold text-cocoa-0">Reconectando ao servidor da turma…</div>
        )}
        <div className="flex min-h-0 flex-1">
          <div className="flex min-w-0 flex-1 flex-col">{main}</div>
          {members && <MemberList server={server!} />}
        </div>
      </main>

      <ProfilePopover />
      <UserMenu />
      <HypeAlert />
      <NoiteAlert />
      <PersistentPlayer />
      <MessageAlerts />
      <ContextMenuHost />
      <GameReporter />
      <Modals />
      {toastMsg && (
        <div key={toastMsg.id} role="status" className="slide-in glass-float toast-glass fixed bottom-5 left-1/2 z-[60] -translate-x-1/2 rounded-[12px] bg-oat px-4 py-2.5 text-[13.5px] font-semibold text-cocoa-0">
          {toastMsg.text}
        </div>
      )}
    </div>
  );
}
