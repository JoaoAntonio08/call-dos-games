"use client";

// Animação de entrada do app, uma vez por sessão.
// Estilizado: uma gota de vidro tingida cresce, aumenta o logo com franja colorida na borda (como lente),
// solta o logo e some, revelando o app. Normal: o logo aparece e some, rápido.
// Clique ou qualquer tecla pula. Quem pediu "menos movimento" no sistema não vê.
import { useEffect, useState } from "react";
import { prefersReducedMotion, tintColor, useLook } from "@/lib/aparencia";
import { useStore } from "@/lib/store";

const SEEN = "cdg:intro-vista";
const LENGTH = { estilizado: 2600, normal: 1000 } as const;

function alreadySeen(): boolean {
  try {
    return sessionStorage.getItem(SEEN) === "1";
  } catch {
    return false;
  }
}

/** O logo do Call dos Games: balão de conversa com um controle dentro. */
export function LogoMark({ tint, className = "" }: { tint: string; className?: string }) {
  return (
    <svg viewBox="0 0 120 120" className={className} aria-hidden>
      <path d="M60 14c27.6 0 50 18.3 50 41s-22.4 41-50 41c-5.3 0-10.4-.7-15.2-1.9L22 106l4.6-20.3C15.7 78.3 10 67.3 10 55c0-22.7 22.4-41 50-41Z" fill="#fff" />
      <path d="M36 50h7v-7h6v7h7v6h-7v7h-6v-7h-7z" fill={tint} />
      <circle cx="78" cy="46" r="5" fill={tint} />
      <circle cx="69" cy="56" r="5" fill={tint} opacity=".55" />
      <circle cx="87" cy="56" r="5" fill={tint} opacity=".55" />
      <circle cx="78" cy="66" r="5" fill={tint} />
    </svg>
  );
}

export function Intro() {
  const { style, intro, tint, replay } = useLook();
  const me = useStore((s) => s.me);
  const [run, setRun] = useState<null | { mode: "estilizado" | "normal"; key: number }>(null);
  // primeira abertura da sessão (depois de montar: o HTML do servidor não tem a animação)
  useEffect(() => {
    if (!intro || alreadySeen() || prefersReducedMotion()) return;
    const f = requestAnimationFrame(() => setRun({ mode: style, key: 0 }));
    return () => cancelAnimationFrame(f);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // "Ver a animação" nas configurações: cada pedido muda o número
  const [lastReplay, setLastReplay] = useState(replay);
  if (replay !== lastReplay) {
    setLastReplay(replay);
    setRun({ mode: style, key: replay });
  }

  useEffect(() => {
    if (!run) return;
    try {
      sessionStorage.setItem(SEEN, "1");
    } catch {
      /* sem armazenamento */
    }
    const done = window.setTimeout(() => setRun(null), LENGTH[run.mode]);
    const skip = () => setRun(null);
    window.addEventListener("keydown", skip, { once: true });
    return () => {
      window.clearTimeout(done);
      window.removeEventListener("keydown", skip);
    };
  }, [run]);

  if (!run) return null;
  const color = tint === "servidor" ? "var(--glass-tint, #5865f2)" : tintColor(tint, undefined, me?.accent);
  return (
    <div
      key={run.key}
      className={`intro intro-${run.mode}`}
      style={{ ["--intro-tint" as string]: color }}
      onClick={() => setRun(null)}
      role="presentation"
      aria-hidden
    >
      {run.mode === "estilizado" && <div className="intro-aurora" />}
      <div className="intro-stage">
        {run.mode === "estilizado" && (
          <>
            <span className="intro-ripple" />
            <span className="intro-drop">
              <span className="intro-sheen" />
            </span>
          </>
        )}
        <LogoMark tint={color} className="intro-logo" />
      </div>
      <p className="intro-name">Call dos Games</p>
    </div>
  );
}
