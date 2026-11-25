"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Dices, Mic, MicOff, MonitorUp, Music2 } from "lucide-react";
import { WarpCarousel, type WarpCard } from "@/components/ui/warp-carousel";
import { getToken } from "@/lib/api";
import { normalizeKey, randomKey, roomNameFromKey } from "@/lib/room-key";
import { display } from "@/lib/fonts";
import { loadName, saveName, setAutoJoin } from "@/lib/prefs";

const OAT = "#f2f3f5";
const EMBER = "#5865f2";
const COCOA = "#18191c";

const CARDS: WarpCard[] = [
  {
    title: "Tela de\njogo",
    value: "4",
    unit: "K",
    footer: "Até 3840 × 2160",
    detail: "ring",
    numeral: [OAT, "#ffffff"],
    accent: OAT,
    glow: EMBER,
    mesh: ["#101226", "#232a6b", "#3c47c4", "#5865f2", "#7884f6", "#5865f2", "#2c3590", "#101226"],
  },
  {
    title: "Quadros por\nsegundo",
    value: "60",
    unit: "fps",
    footer: "Liso até no Elden Ring",
    detail: "wave",
    numeral: [OAT, EMBER],
    accent: EMBER,
    glow: COCOA,
    mesh: ["#111214", "#1f2023", "#27282c", "#313238", "#404249", "#1f2023", "#111214"],
  },
  {
    title: "Volume de\ncada um",
    value: "80",
    unit: "%",
    footer: "O som da aba vai junto",
    detail: "slider",
    labels: ["Voz", "Anime"],
    numeral: [OAT, "#f6d9c6"],
    accent: EMBER,
    glow: "#3c45a5",
    mesh: ["#26272d", "#1c1d21", "#141518", "#1e2350", "#3c45a5", "#26272d"],
  },
  {
    title: "YouTube em\nsincronia",
    value: "0",
    unit: "s",
    footer: "Play e pause para todos",
    detail: "cross",
    labels: ["Sync", "in", "out"],
    numeral: [OAT, "#ffffff"],
    accent: OAT,
    glow: EMBER,
    mesh: ["#5865f2", "#4752c4", "#2f3796", "#151838", "#111214", "#232a6b"],
  },
];

const FEATURES = [
  ["Servidores da turma", "Canais de texto e de voz, convite por link, cargos de dono e admin, emojis próprios."],
  ["Call que aguenta", "Tela até 4K e 60 fps, com o som do jogo ou do anime junto. Volume separado para cada pessoa."],
  ["Soundboard", "Cada um sobe seus sons e toca para todo mundo. E o seu som de entrada anuncia quando você chega."],
  ["Perfil com cara de você", "Foto e banner, parados ou animados. Bio, pronomes, cor e frase de status."],
  ["Coisas pra fazer junto", "YouTube sincronizado, quadro para rabiscar e roleta para decidir o anime da noite."],
  ["Conversas e amigos", "Mensagens diretas, chamadas, reações, respostas, menções e anexos de até 25 MB."],
] as const;

export function Landing() {
  const router = useRouter();
  const [logged, setLogged] = useState(false);
  const [name, setName] = useState("");
  const [key, setKey] = useState("");
  const [spin, setSpin] = useState(0);

  useEffect(() => {
    setLogged(!!getToken());
    setName(loadName());
    setKey(randomKey());
  }, []);

  const k = normalizeKey(key);

  return (
    <main className="flex-1 overflow-x-hidden bg-cocoa-1">
      {/* topo */}
      <header className="mx-auto flex max-w-[1240px] items-center justify-between px-5 py-5 sm:px-8">
        <Link href="/" className="font-display text-[24px] leading-none">
          Call dos Games
        </Link>
        <nav className="flex items-center gap-2 text-[14.5px]">
          {logged ? (
            <Link href="/app" className="btn-ember px-4 py-2">
              Abrir o app →
            </Link>
          ) : (
            <>
              <Link href="/entrar" className="link-u px-3 py-2 text-oat/75 hover:text-oat">
                Entrar
              </Link>
              <Link href="/criar-conta" className="btn-ember px-4 py-2">
                Criar conta
              </Link>
            </>
          )}
        </nav>
      </header>

      {/* abertura: título grande à esquerda, "foto" da call inclinada à direita */}
      <section className="mx-auto grid max-w-[1240px] gap-12 px-5 pb-20 pt-10 sm:px-8 lg:grid-cols-[1.25fr_1fr] lg:pt-16">
        <div>
          <p className="label text-ember">Feito para a turma, não para o mundo</p>
          <h1 className="mt-5 font-display text-[clamp(56px,9vw,128px)] leading-[0.9] tracking-[-0.025em]">
            Um cantinho
            <br />
            <span className="font-display-wonk text-ember-2">pra turma</span> toda.
          </h1>
          <p className="mt-7 max-w-[44ch] text-[17px] leading-relaxed text-oat/65">
            Servidor, chat e call num lugar só, hospedado por vocês mesmos. Sem plano pago, sem limite de tela e com o soundboard cheio de piada interna.
          </p>
          <div className="mt-9 flex flex-wrap items-center gap-3">
            <Link href={logged ? "/app" : "/criar-conta"} className="btn-ember px-6 py-3.5 text-[16px]">
              {logged ? "Voltar para a turma" : "Puxar uma cadeira"}
            </Link>
            <a href="#rapida" className="link-u px-2 py-3 text-[15px] text-oat/60 hover:text-oat">
              ou abrir uma call rápida sem conta
            </a>
          </div>
        </div>

        {/* polaroid da call */}
        <figure aria-hidden className="relative mx-auto w-full max-w-[440px] self-center rotate-[2.5deg] rounded-[22px] bg-oat p-3 pb-12 text-cocoa-0 transition-transform duration-500 hover:rotate-[0.5deg]">
          <div className="rounded-[14px] bg-cocoa-2 p-3 text-oat">
            <div className="flex items-center gap-2 text-[12.5px] font-semibold text-oat/70">
              <span className="live-dot !bg-moss" /> Sala de estar · 4 pessoas
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              {[
                ["Ana", "#5865f2", true, false],
                ["Beto", "#23a55a", false, true],
                ["Caio", "#f0b232", false, false],
                ["Duda", "#eb459e", false, false],
              ].map(([n, c, speaking, muted]) => (
                <div
                  key={n as string}
                  className="relative grid aspect-video place-items-center rounded-[12px]"
                  style={{ background: `color-mix(in srgb, ${c} 22%, #27282c)`, boxShadow: speaking ? "0 0 0 3px #23a55a" : undefined }}
                >
                  <span className="grid size-12 place-items-center rounded-full font-display text-[20px] text-oat" style={{ background: `color-mix(in srgb, ${c} 75%, #18191c)` }}>
                    {(n as string)[0]}
                  </span>
                  <span className="absolute bottom-1.5 left-1.5 flex items-center gap-1 rounded-full bg-cocoa-0/75 px-2 py-0.5 text-[10.5px] font-semibold">
                    {muted ? <MicOff className="size-3 text-rust" /> : <Mic className="size-3 text-oat/60" />}
                    {n as string}
                  </span>
                </div>
              ))}
            </div>
            <div className="mt-3 flex items-center justify-center gap-1.5">
              <span className="grid size-8 place-items-center rounded-[10px] bg-cocoa-4"><MonitorUp className="size-4" /></span>
              <span className="grid size-8 place-items-center rounded-[10px] bg-oat text-cocoa-0"><Music2 className="size-4" /></span>
              <span className="rounded-[10px] bg-cocoa-4 px-2.5 py-1.5 text-[11px] font-semibold">💀 bruh</span>
              <span className="rounded-[10px] bg-cocoa-4 px-2.5 py-1.5 text-[11px] font-semibold">🦆 quack</span>
            </div>
          </div>
          <figcaption className="absolute inset-x-0 bottom-3 text-center font-display-wonk text-[19px] text-cocoa-2">sexta, 23h, ninguém dorme</figcaption>
        </figure>
      </section>

      {/* o que tem na casa */}
      <section className="border-y border-oat/[0.07] bg-cocoa-0">
        <div className="mx-auto grid max-w-[1240px] gap-12 px-5 py-20 sm:px-8 lg:grid-cols-[0.8fr_1.2fr]">
          <div className="lg:sticky lg:top-10 lg:self-start">
            <h2 className="font-display text-[clamp(38px,5vw,64px)] leading-[0.98]">
              O que tem
              <br />
              <span className="italic text-ember-2">na casa</span>
            </h2>
            <div className="mt-8 hidden lg:block">
              <div className="h-[420px]">
                <WarpCarousel
                  cards={CARDS}
                  background="#111214"
                  warp={0.35}
                  font={`${display.style.fontFamily}, Georgia, serif`}
                  ariaLabel="O que a call aguenta"
                  style={{ width: "100%", height: "100%", minHeight: 340, aspectRatio: "auto" }}
                />
              </div>
            </div>
          </div>
          <ol className="divide-y divide-oat/[0.08]">
            {FEATURES.map(([title, text], i) => (
              <li key={title} className="group grid grid-cols-[52px_1fr] gap-4 py-6 first:pt-0">
                <span className="font-display text-[28px] leading-none text-oat/25 transition-colors group-hover:text-ember">{String(i + 1).padStart(2, "0")}</span>
                <div>
                  <h3 className="font-display text-[26px] leading-tight">{title}</h3>
                  <p className="mt-1.5 max-w-[52ch] text-[15.5px] leading-relaxed text-oat/60">{text}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* call rápida, sem conta */}
      <section id="rapida" className="mx-auto max-w-[1240px] px-5 py-20 sm:px-8">
        <div className="grid gap-10 rounded-[24px] border border-oat/[0.08] p-6 sm:p-10 lg:grid-cols-[1fr_1.1fr]">
          <div>
            <p className="label text-ember">Sem conta</p>
            <h2 className="mt-3 font-display text-[40px] leading-tight">Call rápida por chave</h2>
            <p className="mt-3 max-w-[40ch] text-[15.5px] leading-relaxed text-oat/60">
              Quem tiver a mesma chave cai na mesma call. Bom para chamar alguém que ainda não tem conta.
            </p>
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!name.trim() || !roomNameFromKey(k)) return;
              saveName(name.trim());
              setAutoJoin(k);
              router.push(`/sala/${k}`);
            }}
            className="space-y-3"
          >
            <input className="field h-12" value={name} onChange={(e) => setName(e.target.value)} placeholder="Seu nome" maxLength={32} aria-label="Seu nome" />
            <div className="flex gap-2">
              <input className="field h-12 flex-1" value={key} onChange={(e) => setKey(e.target.value)} placeholder="chave-da-sala" aria-label="Chave da sala" />
              <button
                type="button"
                onClick={() => {
                  setKey(randomKey());
                  setSpin((s) => s + 1);
                }}
                aria-label="Sortear chave"
                className="btn-quiet grid size-12 place-items-center"
              >
                <Dices className="size-5 transition-transform duration-300" style={{ transform: `rotate(${spin * 90}deg)` }} />
              </button>
            </div>
            <button type="submit" disabled={!name.trim() || !roomNameFromKey(k)} className="btn-ember h-12 w-full text-[15px]">
              Entrar na call
            </button>
          </form>
        </div>
      </section>

      <footer className="mx-auto flex max-w-[1240px] flex-wrap items-center justify-between gap-3 px-5 pb-10 text-[13px] text-oat/40 sm:px-8">
        <span className="font-display text-[16px] text-oat/60">Call dos Games</span>
        <span>
          <Link href="/novidades" className="mr-3 font-semibold text-oat/60 hover:text-oat">
            Novidades
          </Link>
          Melhor no Chrome ou Edge · use fone na call
        </span>
      </footer>
    </main>
  );
}
