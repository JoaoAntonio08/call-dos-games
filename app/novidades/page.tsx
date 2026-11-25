import type { Metadata } from "next";
import Link from "next/link";
import { Banner, ReleaseBody, ReleaseMeta } from "@/components/novidades/release";
import { LATEST, RELEASES, slugOf } from "@/lib/changelog";

export const metadata: Metadata = {
  title: "Novidades · Call dos Games",
  description: `O que mudou no Call dos Games. Na versão ${LATEST.version}: ${LATEST.title}.`,
};

export default function NovidadesPage() {
  return (
    <main className="min-h-full bg-cocoa-1">
      <header className="sticky top-0 z-20 border-b border-white/[0.05] bg-cocoa-1/85 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-[1120px] items-center gap-3 px-4 sm:px-6">
          <Link href="/" className="flex items-center gap-2 font-display text-[17px] font-bold">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/icons/icon-192.png" alt="" className="size-7 rounded-[8px]" />
            <span className="hidden sm:inline">Call dos Games</span>
          </Link>
          <span className="hidden text-oat/25 sm:inline">/</span>
          <span className="text-[14px] font-semibold text-oat/70">Novidades</span>
          <Link href="/app" className="btn-ember ml-auto inline-flex h-9 items-center px-4 text-[13.5px]">
            Abrir o app
          </Link>
        </div>
      </header>

      <div className="mx-auto max-w-[1120px] px-4 pb-24 pt-10 sm:px-6 lg:grid lg:grid-cols-[180px_1fr] lg:gap-12">
        <nav aria-label="Versões" className="hidden lg:block">
          <div className="sticky top-24">
            <p className="label text-oat/40">Versões</p>
            <ul className="mt-3 space-y-0.5 border-l border-white/[0.06]">
              {RELEASES.map((r, i) => (
                <li key={r.version}>
                  <a href={`#${slugOf(r.version)}`} className="-ml-px block border-l-2 border-transparent py-1.5 pl-3 text-[13.5px] text-oat/55 hover:border-ember hover:text-oat">
                    <span className="font-semibold">{r.version}</span>
                    {i === 0 && <span className="ml-2 rounded-full bg-rust px-1.5 py-px text-[10px] font-extrabold uppercase text-white">nova</span>}
                    <span className="block truncate text-[12px] text-oat/35">{r.title}</span>
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </nav>

        <div className="min-w-0">
          <p className="label text-ember-2">O que mudou</p>
          <h1 className="mt-2 font-display text-[clamp(40px,7vw,72px)] font-extrabold leading-[0.9]">Novidades</h1>
          <p className="mt-3 max-w-[560px] text-[16px] text-oat/60">
            Tudo que chegou no Call dos Games, versão por versão. Quem já usa não precisa baixar nada: as novidades chegam sozinhas pelo site e pelos apps.
          </p>

          <div className="mt-10 space-y-20">
            {RELEASES.map((r, i) => (
              <article key={r.version} id={slugOf(r.version)} className="scroll-mt-24">
                <div className="nv-rise" style={{ animationDelay: `${Math.min(i, 2) * 0.08}s` }}>
                  <Banner release={r} />
                </div>
                <div className="mt-5">
                  <ReleaseMeta release={r} />
                  <p className="mt-2 max-w-[680px] text-[17px] leading-relaxed text-oat/85">{r.summary}</p>
                </div>
                <div className="mt-8">
                  <ReleaseBody release={r} />
                </div>
              </article>
            ))}
          </div>

          <p className="mt-20 text-[13px] text-oat/35">
            Versões mais antigas estão no{" "}
            <a href="https://github.com/JoaoAntonio08/call-dos-games/releases" target="_blank" rel="noreferrer noopener" className="underline hover:text-oat/60">
              histórico do GitHub
            </a>
            .
          </p>
        </div>
      </div>
    </main>
  );
}
