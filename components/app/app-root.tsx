"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { API_READY } from "@/lib/api";
import { bootstrap, useStore } from "@/lib/store";
import { ApiPending } from "@/components/api-pending";
import { VoiceProvider } from "@/lib/voice";
import { Shell } from "./shell";

const LAMP_LINES = ["Acendendo o abajur…", "Ajeitando as almofadas…", "Esquentando a pipoca…", "Chamando a turma…"];

export function AppRoot() {
  const phase = useStore((s) => s.phase);
  const router = useRouter();
  const path = usePathname();

  useEffect(() => {
    if (!API_READY) return;
    void bootstrap();
    const onLogout = () => useStore.setState({ phase: "anon" });
    window.addEventListener("cdg:logout", onLogout);
    return () => window.removeEventListener("cdg:logout", onLogout);
  }, []);

  // o app de Windows pede para abrir links do próprio site aqui dentro (sem recarregar e sem derrubar a call)
  useEffect(() => {
    const w = window as unknown as { __cdgOpen?: (p: string) => void };
    w.__cdgOpen = (p: string) => router.push(p);
    return () => {
      delete w.__cdgOpen;
    };
  }, [router]);

  useEffect(() => {
    if (API_READY && phase === "anon") router.replace(`/entrar?next=${encodeURIComponent(path)}`);
  }, [phase, router, path]);

  if (!API_READY) return <ApiPending />;
  if (phase !== "ready") {
    return (
      <main className="grid min-h-svh flex-1 place-items-center bg-cocoa-1">
        <div className="text-center">
          <p className="font-display-wonk text-[34px] text-oat">{LAMP_LINES[0]}</p>
          <p className="mt-3 text-[13px] text-oat/40">Se demorar, o servidor da turma pode estar dormindo.</p>
        </div>
      </main>
    );
  }

  return (
    <VoiceProvider>
      <Shell />
    </VoiceProvider>
  );
}
