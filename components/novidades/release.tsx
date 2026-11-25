import type { CSSProperties, ReactNode } from "react";
import { type ChangeItem, type Demo, type Release, type Scene, type Tag, TAG_LABEL, dateLabel } from "@/lib/changelog";

/* Peças da página /novidades e do aviso "O que mudou": sem hooks, servem no servidor e no cliente. */

const SCENES: Record<Scene, { bg: string; floaters: string[] }> = {
  jogos: { bg: "linear-gradient(125deg, #5865f2, #eb459e 45%, #f0b232)", floaters: ["🎮", "🕵️", "🌍", "🎵", "😂", "🟩"] },
  conquistas: { bg: "linear-gradient(125deg, #f0b232, #eb459e 50%, #9b59b6)", floaters: ["🏆", "⭐", "👑", "💎", "✨"] },
  servidor: { bg: "linear-gradient(125deg, #00a8fc, #5865f2 50%, #9b59b6)", floaters: ["🖥️", "⚡", "📡", "🪟", "4K"] },
  radio: { bg: "linear-gradient(125deg, #23a55a, #1abc9c 45%, #00a8fc)", floaters: ["📻", "🎶", "🎧", "💿", "🎤"] },
  ponte: { bg: "linear-gradient(125deg, #5865f2, #1abc9c 55%, #23a55a)", floaters: ["🌉", "💬", "🎉", "🔔", "🗓️"] },
  desktop: { bg: "linear-gradient(125deg, #313238, #5865f2 55%, #00a8fc)", floaters: ["🪟", "🪶", "⚡", "🔐", "🖱️"] },
};

// onde cada enfeite flutua no banner (em %), com giro e atraso diferentes;
// low = fica na altura do título, então some em tela pequena e no aviso compacto;
// corner = canto de cima, onde o aviso tem o botão de fechar
const SPOTS: { left: number; top: number; r: number; d: number; s: number; low?: boolean; corner?: boolean }[] = [
  { left: 58, top: 14, r: -8, d: 0, s: 46 },
  { left: 76, top: 48, r: 10, d: 1.1, s: 54 },
  { left: 90, top: 10, r: -12, d: 2.2, s: 38, corner: true },
  { left: 68, top: 70, r: 6, d: 0.6, s: 34, low: true },
  { left: 84, top: 78, r: -6, d: 1.7, s: 40 },
  { left: 48, top: 60, r: 12, d: 2.8, s: 30, low: true },
];

export function Banner({ release, size = "lg" }: { release: Release; size?: "lg" | "md" }) {
  const scene = SCENES[release.scene];
  const big = size === "lg";
  return (
    <div
      className={`nv-banner nv-sheen relative isolate overflow-hidden ${big ? "h-[220px] rounded-[22px] sm:h-[280px]" : "h-[170px] sm:h-[190px]"}`}
      style={{ backgroundImage: scene.bg }}
    >
      <div className="nv-dots absolute inset-0" />
      <div className="absolute -bottom-24 -left-16 size-72 rounded-full bg-white/10 blur-2xl" />
      {scene.floaters.map((f, i) => {
        const p = SPOTS[i % SPOTS.length];
        return (
          <span
            key={i}
            aria-hidden
            className={`nv-float absolute grid place-items-center rounded-[18px] bg-white/15 font-display font-extrabold text-white shadow-[0_10px_30px_rgb(0_0_0/0.18)] backdrop-blur-sm ${p.low ? (big ? "max-sm:hidden" : "hidden") : ""} ${p.corner && !big ? "hidden" : ""}`}
            style={
              {
                left: `${p.left}%`,
                top: `${p.top}%`,
                width: p.s * (big ? 1.25 : 1),
                height: p.s * (big ? 1.25 : 1),
                fontSize: p.s * (big ? 0.62 : 0.5),
                "--r": `${p.r}deg`,
                animationDelay: `${p.d}s`,
              } as CSSProperties
            }
          >
            {f}
          </span>
        );
      })}
      <div className={`absolute inset-x-0 bottom-0 ${big ? "p-6 sm:p-8" : "p-5"} [text-shadow:0_2px_16px_rgb(0_0_0/0.25)]`}>
        <span className="inline-flex items-center rounded-full bg-black/25 px-2.5 py-1 text-[11.5px] font-bold uppercase tracking-[0.12em] text-white backdrop-blur-sm">
          Versão {release.version}
        </span>
        <h2 className={`mt-2 max-w-[70%] font-display font-extrabold leading-[0.95] text-white ${big ? "text-[clamp(32px,6vw,56px)]" : "text-[30px]"}`}>{release.title}</h2>
      </div>
    </div>
  );
}

const TAG_TONE: Record<Tag, string> = { novo: "#f23f43", melhorou: "#5865f2", corrigido: "#23a55a" };

/** Cabeçalho de seção no jeito do Discord: texto colorido com uma linha que corre até o fim. */
function TagHeader({ tag }: { tag: Tag }) {
  return (
    <h3 className="flex items-center gap-3 text-[12.5px] font-extrabold uppercase tracking-[0.14em]" style={{ color: TAG_TONE[tag] }}>
      {TAG_LABEL[tag]}
      <span className="h-px flex-1" style={{ background: `linear-gradient(90deg, ${TAG_TONE[tag]}, transparent)` }} />
    </h3>
  );
}

export function ReleaseBody({ release, limit }: { release: Release; limit?: number }) {
  // com limite (o aviso dentro do app), corta os primeiros N itens somando todos os grupos
  const groups = release.groups.map((g, gi) => {
    const before = release.groups.slice(0, gi).reduce((n, x) => n + x.items.length, 0);
    const room = Math.max(0, (limit ?? Infinity) - before);
    return { tag: g.tag, items: g.items.slice(0, room) };
  });
  return (
    <div className="space-y-8">
      {groups
        .filter((g) => g.items.length)
        .map((g) => (
          <section key={g.tag}>
            <TagHeader tag={g.tag} />
            <ul className="mt-4 grid gap-3 sm:grid-cols-2">
              {g.items.map((it) => (
                <Item key={it.title} item={it} />
              ))}
            </ul>
          </section>
        ))}
    </div>
  );
}

function Item({ item }: { item: ChangeItem }) {
  const wide = !!(item.demo || item.media);
  return (
    <li className={`overflow-hidden rounded-[16px] bg-cocoa-2 ring-1 ring-white/[0.04] ${wide ? "" : "self-start"}`}>
      {item.media ? (
        item.media.kind === "video" ? (
          <video src={item.media.src} aria-label={item.media.alt} autoPlay muted loop playsInline className="aspect-video w-full object-cover" />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={item.media.src} alt={item.media.alt} className="aspect-video w-full object-cover" loading="lazy" />
        )
      ) : item.demo ? (
        <div className="relative h-[132px] overflow-hidden bg-cocoa-0/70" aria-hidden>
          <DemoView demo={item.demo} />
        </div>
      ) : null}
      <div className="flex gap-3 p-4">
        <span className="grid size-10 shrink-0 place-items-center rounded-[12px] bg-cocoa-3 text-[20px]" aria-hidden>
          {item.emoji}
        </span>
        <div className="min-w-0">
          <p className="text-[15.5px] font-bold leading-tight">{item.title}</p>
          <p className="mt-1 text-[14px] leading-relaxed text-oat/70">{item.text}</p>
        </div>
      </div>
    </li>
  );
}

export function ReleaseMeta({ release }: { release: Release }) {
  return (
    <p className="text-[13px] text-oat/50">
      {dateLabel(release.date)} · versão {release.version}
    </p>
  );
}

/* ------------------------------------------------------------------ */
/* Animaçõezinhas: um "GIF" feito de CSS para cada novidade            */
/* ------------------------------------------------------------------ */

function Center({ children }: { children: ReactNode }) {
  return <div className="absolute inset-0 grid place-items-center">{children}</div>;
}

const GREEN = "#23a55a";
const YELLOW = "#c9a227";
const GREY = "#3a3c43";

function DemoView({ demo }: { demo: Demo }) {
  switch (demo) {
    case "impostor":
      return (
        <Center>
          <div className="flex gap-2.5 [perspective:600px]">
            {["🏖️ praia", "🏖️ praia", "❓ impostor", "🏖️ praia"].map((back, i) => (
              <div key={i} className="nv-card relative h-[88px] w-[62px]" style={{ animationDelay: `${i * 0.18}s` }}>
                <div className="absolute inset-0 grid place-items-center rounded-[10px] bg-gradient-to-br from-ember to-[#9b59b6] text-[22px] font-black text-white/90">?</div>
                <div
                  className={`absolute inset-0 grid place-items-center rounded-[10px] px-1 text-center text-[11px] font-bold leading-tight [transform:rotateY(180deg)] ${i === 2 ? "bg-rust text-white" : "bg-oat text-cocoa-0"}`}
                >
                  <span>
                    <span className="block text-[22px]">{back.split(" ")[0]}</span>
                    {back.split(" ")[1]}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </Center>
      );
    case "forca":
      return (
        <Center>
          <div className="flex flex-col items-center gap-3">
            <div className="flex gap-2">
              {"GALO".split("").map((ch, i) => (
                <span key={i} className="grid h-[40px] w-[34px] place-items-end justify-center border-b-[3px] border-oat/40 pb-1 font-display text-[24px] font-extrabold">
                  <span className="nv-pop" style={{ "--d": `${[0, 0.5, 0.25, 0.75][i]}s` } as CSSProperties}>
                    {ch}
                  </span>
                </span>
              ))}
            </div>
            <div className="flex items-center gap-1.5 text-[16px]">
              <span>❤️</span>
              <span>❤️</span>
              <span>❤️</span>
              <span className="nv-blink">🖤</span>
              <span className="ml-2 rounded-full bg-cocoa-3 px-2 py-0.5 text-[11.5px] text-oat/60">E · S · T</span>
            </div>
          </div>
        </Center>
      );
    case "quina": {
      const rows: [string, string[]][] = [
        ["CARRO", [GREY, YELLOW, GREY, GREY, GREY]],
        ["PRAIA", [GREEN, GREEN, GREEN, GREEN, GREEN]],
      ];
      return (
        <Center>
          <div className="space-y-1.5">
            {rows.map(([word, colors], r) => (
              <div key={word} className="flex gap-1.5 [perspective:400px]">
                {word.split("").map((ch, i) => (
                  <span
                    key={i}
                    className="nv-tile grid size-[42px] place-items-center rounded-[8px] font-display text-[20px] font-extrabold text-white"
                    style={{ "--c": colors[i], animationDelay: `${r * 0.9 + i * 0.12}s` } as CSSProperties}
                  >
                    {ch}
                  </span>
                ))}
              </div>
            ))}
          </div>
        </Center>
      );
    }
    case "mapa":
      return (
        <div className="absolute inset-0 bg-[#1b3a4b]">
          {/* continentes de brinquedo */}
          <svg viewBox="0 0 320 132" className="absolute inset-0 h-full w-full" preserveAspectRatio="xMidYMid slice">
            <g fill="#2f6b55">
              <path d="M28 30c18-12 52-14 66 2 10 12-4 26 8 38 8 8-6 22-22 18-18-4-26-20-40-24C22 60 14 40 28 30z" />
              <path d="M96 86c10-6 24 0 26 12 2 14-10 28-20 26-10-2-14-30-6-38z" />
              <path d="M150 24c20-8 44-6 54 6 6 8-8 14 0 22 10 10 30 4 44 0 22-6 44 4 46 18 2 12-22 14-36 12-16-2-30 10-46 6-14-4-12-20-26-22-14-2-26-6-30-18-2-10-14-14-6-24z" />
              <path d="M236 92c14-6 34-2 38 10 2 10-16 16-28 12-10-2-18-16-10-22z" />
            </g>
            <line x1="122" y1="58" x2="176" y2="40" stroke="#fff" strokeWidth="2" className="nv-line" />
          </svg>
          <span className="nv-pin absolute text-[26px] leading-none" style={{ left: "37%", top: "30%" }}>
            📍
          </span>
          <span className="nv-pop absolute text-[22px] leading-none" style={{ left: "53%", top: "18%", "--d": "0.2s" } as CSSProperties}>
            🎯
          </span>
          <span className="nv-pop absolute rounded-full bg-black/45 px-2.5 py-1 text-[12.5px] font-bold text-white" style={{ right: 14, bottom: 12, "--d": "0.4s" } as CSSProperties}>
            1.240 km · +2.689
          </span>
        </div>
      );
    case "musica":
      return (
        <Center>
          <div className="flex items-end gap-6">
            <div className="flex h-[64px] items-end gap-1">
              {[0.9, 0.5, 1, 0.7, 0.4, 0.8, 0.6].map((h, i) => (
                <span key={i} className="nv-bar w-2 rounded-full bg-gradient-to-t from-ember to-[#eb459e]" style={{ height: `${h * 64}px`, "--d": `${i * 0.13}s` } as CSSProperties} />
              ))}
            </div>
            <div className="space-y-1.5">
              {[
                ["🥇", "Ana", "+3"],
                ["🥈", "Leo", "+2"],
                ["🥉", "Bia", "+1"],
              ].map(([m, n, p], i) => (
                <div key={n} className="nv-pop flex items-center gap-2 rounded-full bg-cocoa-3 px-2.5 py-1 text-[12.5px]" style={{ "--d": `${i * 0.25}s` } as CSSProperties}>
                  <span>{m}</span>
                  <b>{n}</b>
                  <span className="text-moss">{p}</span>
                </div>
              ))}
            </div>
          </div>
        </Center>
      );
    case "risada":
      return (
        <Center>
          <div className="flex flex-col items-center gap-3">
            <div className="flex h-[54px] items-end gap-[3px]">
              {Array.from({ length: 26 }, (_, i) => (
                <span
                  key={i}
                  className="nv-laugh w-[5px] rounded-full bg-honey"
                  style={{ height: 54, "--h": `${0.35 + Math.abs(Math.sin(i * 1.7)) * 0.65}`, "--d": `${(i % 6) * 0.04}s` } as CSSProperties}
                />
              ))}
            </div>
            <span className="nv-pop rounded-full bg-moss px-3 py-1 text-[12.5px] font-bold text-white" style={{ "--d": "0.3s" } as CSSProperties}>
              😂 Clipe salvo: momento de risada
            </span>
          </div>
        </Center>
      );
    case "recado":
      return (
        <Center>
          <div className="w-[230px] rounded-[14px] bg-cocoa-3 p-3">
            <div className="flex items-center gap-2 text-[12.5px] font-semibold">
              <span className="nv-blink size-2.5 rounded-full bg-rust" />
              Gravando recado
              <span className="ml-auto tabular-nums text-oat/50">0:30</span>
            </div>
            <div className="mt-2.5 h-2 overflow-hidden rounded-full bg-cocoa-5">
              <div className="nv-fill h-full rounded-full bg-gradient-to-r from-ember to-[#eb459e]" />
            </div>
            <p className="mt-2 text-[11.5px] text-oat/45">Quem entrar depois ouve 👂</p>
          </div>
        </Center>
      );
    case "retro":
      return (
        <Center>
          <div className="w-[240px] space-y-2">
            {[
              ["👑", 1, "#f0b232", "38 h"],
              ["2", 0.72, "#5865f2", "27 h"],
              ["3", 0.5, "#eb459e", "19 h"],
            ].map(([who, w, c, label], i) => (
              <div key={i} className="flex items-center gap-2 text-[12px]">
                <span className="w-5 text-center font-display font-bold text-oat/60">{who}</span>
                <div className="h-5 flex-1">
                  <div className="nv-grow flex h-full items-center justify-end rounded-[6px] px-2 font-bold text-white" style={{ width: `${Number(w) * 100}%`, background: String(c), "--d": `${i * 0.15}s` } as CSSProperties}>
                    {label}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Center>
      );
    case "placa":
      return (
        <Center>
          <div className="nv-sheen relative overflow-hidden rounded-[12px] px-5 py-3 text-center" style={{ background: "linear-gradient(120deg, #9b59b6, #00a8fc, #23a55a, #f0b232, #eb459e)", backgroundSize: "300% 300%" }}>
            <div className="nv-banner absolute inset-0" style={{ background: "inherit", backgroundSize: "300% 300%" }} />
            <p className="relative font-display text-[18px] font-extrabold text-white [text-shadow:0_1px_8px_rgb(0_0_0/0.3)]">🏆 Streamer</p>
            <p className="relative text-[11px] font-semibold text-white/85">25 h transmitindo</p>
          </div>
        </Center>
      );
    case "qualidade":
      return (
        <Center>
          <div className="flex items-center gap-4">
            <div className="relative h-[70px] w-[118px] rounded-[10px] bg-gradient-to-br from-[#00a8fc] to-ember">
              <span className="absolute left-2 top-2 flex items-center gap-1 rounded-[5px] bg-rust px-1.5 text-[10px] font-extrabold text-white">
                <span className="nv-blink size-1.5 rounded-full bg-white" /> AO VIVO
              </span>
            </div>
            <div className="nv-cycle grid font-display text-[34px] font-extrabold">
              <span style={{ "--d": "0s", color: "#23a55a" } as CSSProperties}>4K</span>
              <span style={{ "--d": "2s", color: "#f0b232" } as CSSProperties}>1080p</span>
              <span style={{ "--d": "4s", color: "#00a8fc" } as CSSProperties}>720p</span>
            </div>
          </div>
        </Center>
      );
    case "eq":
      return (
        <Center>
          <div className="flex items-center gap-5">
            <div className="nv-spin grid size-[76px] place-items-center rounded-full bg-[repeating-radial-gradient(circle,#111214_0_3px,#1f2023_3px_5px)]">
              <span className="size-6 rounded-full bg-gradient-to-br from-moss to-[#1abc9c]" />
            </div>
            <div className="flex h-[56px] items-end gap-1">
              {[0.6, 1, 0.75, 0.4, 0.9, 0.55].map((h, i) => (
                <span key={i} className="nv-bar w-2 rounded-full bg-moss" style={{ height: `${h * 56}px`, "--d": `${i * 0.16}s` } as CSSProperties} />
              ))}
            </div>
            <span className="rounded-full bg-cocoa-3 px-2.5 py-1 text-[12px] font-semibold">📻 rádio da call</span>
          </div>
        </Center>
      );
  }
}
