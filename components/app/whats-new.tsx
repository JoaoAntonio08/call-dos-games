"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { Banner, ReleaseBody, ReleaseMeta } from "@/components/novidades/release";
import { LATEST } from "@/lib/changelog";

const SEEN_KEY = "cdg:novidades-visto";

function markSeen() {
  try {
    localStorage.setItem(SEEN_KEY, LATEST.version);
  } catch {
    /* tudo bem */
  }
}

/** Avisa "O que mudou" uma vez por versão (e abre de novo pelo evento cdg:novidades). */
export function WhatsNew() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let seen: string | null = LATEST.version;
    try {
      seen = localStorage.getItem(SEEN_KEY);
    } catch {
      /* sem armazenamento: não insiste */
    }
    // um respiro para não brigar com a animação de entrada do app
    const t = seen === LATEST.version ? 0 : window.setTimeout(() => setOpen(true), 1800);
    const show = () => setOpen(true);
    window.addEventListener("cdg:novidades", show);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener("cdg:novidades", show);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      markSeen();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const close = () => {
    setOpen(false);
    markSeen();
  };

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[70] grid place-items-center bg-black/65 p-3 sm:p-6" onClick={close}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Novidades da versão ${LATEST.version}`}
        onClick={(e) => e.stopPropagation()}
        className="pop-in relative flex max-h-[min(88vh,820px)] w-full max-w-[640px] flex-col overflow-hidden rounded-[20px] bg-cocoa-1 shadow-[0_30px_80px_rgb(0_0_0/0.6)]"
      >
        <button
          type="button"
          onClick={close}
          aria-label="Fechar"
          className="press absolute right-3 top-3 z-10 grid size-8 place-items-center rounded-full bg-black/35 text-white backdrop-blur-sm hover:bg-black/55"
        >
          <X className="size-4" />
        </button>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <Banner release={LATEST} size="md" />
          <div className="px-5 pb-6 pt-4 sm:px-6">
            <p className="label text-ember-2">O que há de novo</p>
            <div className="mt-1">
              <ReleaseMeta release={LATEST} />
            </div>
            <p className="mt-2 text-[15.5px] leading-relaxed text-oat/85">{LATEST.summary}</p>
            <div className="mt-6">
              <ReleaseBody release={LATEST} limit={4} />
            </div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2 border-t border-white/[0.05] bg-cocoa-2 px-5 py-3 sm:px-6">
          <a href="/novidades" target="_blank" rel="noopener" className="text-[13.5px] font-semibold text-ember-2 hover:underline">
            Ver tudo que mudou
          </a>
          <button type="button" onClick={close} className="btn-ember ml-auto inline-flex h-9 items-center px-5 text-[14px]">
            Bora!
          </button>
        </div>
      </div>
    </div>
  );
}
