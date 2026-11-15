"use client";

import { useEffect, useState } from "react";
import { Download, X } from "lucide-react";

/**
 * Aviso de versão nova dos apps (Windows e Android).
 * A versão mais nova fica em /apps/versao.json, no próprio site da turma.
 * No Windows o app baixa e instala sozinho; no Android abre o download do APK.
 */

interface Release {
  versao: string;
  url: string;
}
interface Versions {
  windows?: Release;
  android?: Release;
  notas?: string;
}
interface Desktop {
  app: string;
  appVersion?: string;
  update?: (url: string) => Promise<string>;
  onUpdateProgress?: (cb: (pct: number) => void) => () => void;
}

type Where = { app: "windows" | "android"; v: string };

/** Em qual app o site está aberto (e em que versão). Fora dos apps: null. */
function detect(): Where | null {
  const desk = (window as unknown as { cdgDesktop?: Desktop }).cdgDesktop;
  // app de Windows antigo não dizia a versão: conta como 0 para aparecer o aviso
  if (desk?.app === "windows") return { app: "windows", v: desk.appVersion || "0" };
  try {
    const p = new URLSearchParams(location.search);
    if (p.get("app") === "android") {
      sessionStorage.setItem("cdg:app", JSON.stringify({ app: "android", v: p.get("v") || "0" }));
      p.delete("app");
      p.delete("v");
      const q = p.toString();
      history.replaceState(history.state, "", location.pathname + (q ? `?${q}` : "") + location.hash);
    } else if (document.referrer.startsWith("android-app://com.calldosgames.app") && !sessionStorage.getItem("cdg:app")) {
      // APK antigo (sem a versão no endereço)
      sessionStorage.setItem("cdg:app", JSON.stringify({ app: "android", v: "0" }));
    }
    const saved = sessionStorage.getItem("cdg:app");
    return saved ? (JSON.parse(saved) as Where) : null;
  } catch {
    return null;
  }
}

export function newer(a: string, b: string) {
  const pa = a.split(".").map((n) => parseInt(n, 10) || 0);
  const pb = b.split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) > (pb[i] ?? 0);
  }
  return false;
}

export function UpdateBanner() {
  const [offer, setOffer] = useState<{ where: Where; release: Release; notas?: string } | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [state, setState] = useState<"idle" | "baixando" | "instalando" | "erro">("idle");

  useEffect(() => {
    const where = detect();
    if (!where) return;
    let alive = true;
    const check = () =>
      fetch("/apps/versao.json", { cache: "no-store" })
        .then((r) => (r.ok ? (r.json() as Promise<Versions>) : null))
        .then((v) => {
          const release = v?.[where.app];
          if (!alive || !release || !newer(release.versao, where.v)) return;
          try {
            if (sessionStorage.getItem(`cdg:update-depois:${release.versao}`)) return;
          } catch {
            /* sem armazenamento */
          }
          setOffer({ where, release, notas: v?.notas });
        })
        .catch(() => {});
    void check();
    // app aberto o dia todo: confere de novo a cada 6 horas
    const t = window.setInterval(check, 6 * 3600_000);
    return () => {
      alive = false;
      window.clearInterval(t);
    };
  }, []);

  if (!offer) return null;
  const desk = (window as unknown as { cdgDesktop?: Desktop }).cdgDesktop;
  const auto = offer.where.app === "windows" && !!desk?.update;

  async function go() {
    if (!offer) return;
    if (!auto) {
      window.open(offer.release.url, "_blank", "noopener");
      return;
    }
    setState("baixando");
    const off = desk!.onUpdateProgress?.((p) => setProgress(p));
    try {
      await desk!.update!(offer.release.url);
      setState("instalando");
    } catch {
      setState("erro");
    } finally {
      off?.();
    }
  }

  function later() {
    try {
      sessionStorage.setItem(`cdg:update-depois:${offer!.release.versao}`, "1");
    } catch {
      /* sem armazenamento */
    }
    setOffer(null);
  }

  const label =
    state === "baixando"
      ? `Baixando${progress !== null ? ` ${Math.round(progress * 100)}%` : ""}…`
      : state === "instalando"
        ? "Instalando: o app fecha e abre de novo sozinho."
        : state === "erro"
          ? "Não deu para baixar. Tente de novo."
          : auto
            ? "Atualizar agora"
            : offer.where.app === "android"
              ? "Baixar o APK novo"
              : "Baixar o instalador novo";

  return (
    <div role="status" className="flex flex-wrap items-center gap-x-3 gap-y-1.5 bg-ember px-4 py-2 text-[13px] text-white">
      <Download className="size-4 shrink-0" />
      <span className="min-w-0 flex-1">
        <b>Versão nova do app ({offer.release.versao})</b>
        {offer.notas ? <span className="opacity-85"> — {offer.notas}</span> : null}
        {!auto && offer.where.app === "windows" && <span className="opacity-85"> Depois de baixar, é só abrir o instalador.</span>}
        {offer.where.app === "android" && <span className="opacity-85"> Depois de baixar, abra o arquivo para instalar por cima.</span>}
      </span>
      <button
        type="button"
        onClick={() => void go()}
        disabled={state === "baixando" || state === "instalando"}
        className="rounded-[8px] bg-white px-3 py-1 font-semibold text-ember disabled:opacity-80"
      >
        {label}
      </button>
      {state === "idle" && (
        <button type="button" onClick={later} className="rounded-md p-1 opacity-80 hover:opacity-100" aria-label="Lembrar depois">
          <X className="size-4" />
        </button>
      )}
    </div>
  );
}
