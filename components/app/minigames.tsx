"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Check, Crown, Globe2, Grid3x3, Music2, Spline, Timer, VenetianMask } from "lucide-react";
import { api, errorText } from "@/lib/api";
import { nameInChannel, useStore } from "@/lib/store";
import { toast } from "@/lib/ui";

/* ------------------------------------------------------------------ */
/* Minigames da call. Quem decide tudo é o servidor: aqui só chega a    */
/* visão de cada um (a sua carta do Impostor, a forca com tracinhos…). */
/* ------------------------------------------------------------------ */

export type GameKind = "impostor" | "forca" | "quina" | "musica" | "mundo";

export interface GameView {
  kind: GameKind;
  host_id: string;
  players: string[];
  score: Record<string, number>;
  phase: string;
  ends_at: number | null;
  notice: string;
  [k: string]: unknown;
}

/* ---------------- estado: um jogo por call ---------------- */
const games = new Map<string, GameView | null>();
const subs = new Set<() => void>();
let version = 0;
function emit() {
  version++;
  subs.forEach((f) => f());
}
if (typeof window !== "undefined") {
  window.addEventListener("cdg:minigame", (e) => {
    const d = (e as CustomEvent<{ channel_id: string; game: GameView | null }>).detail;
    if (!d?.channel_id) return;
    const before = games.get(d.channel_id);
    games.set(d.channel_id, d.game);
    if (d.game && !before) window.dispatchEvent(new CustomEvent("cdg:minigame-open", { detail: d.channel_id }));
    emit();
  });
}

export function useMinigame(channelId: string | null): GameView | null {
  useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => subs.delete(f);
    },
    () => version,
    () => 0,
  );
  useEffect(() => {
    if (!channelId) return;
    let alive = true;
    api<{ game: GameView | null }>(`/calls/${channelId}/minigame`)
      .then((r) => {
        if (!alive) return;
        games.set(channelId, r.game);
        emit();
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [channelId]);
  return channelId ? (games.get(channelId) ?? null) : null;
}

async function act(channelId: string, body: Record<string, unknown>): Promise<Record<string, unknown> | null> {
  try {
    return await api<Record<string, unknown>>(`/calls/${channelId}/minigame/act`, { json: body });
  } catch (e) {
    toast(errorText(e));
    return null;
  }
}

function useCountdown(endsAt: number | null): number | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!endsAt) return;
    const t = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(t);
  }, [endsAt]);
  return endsAt ? Math.max(0, Math.ceil((endsAt - now) / 1000)) : null;
}

export const GAME_TITLES: Record<GameKind, string> = {
  impostor: "Impostor",
  forca: "Forca",
  quina: "Quina",
  musica: "Adivinhe a música",
  mundo: "Onde foi isso?",
};

/* ------------------------------------------------------------------ */
/* escolher o jogo (no dock "Atividades")                               */
/* ------------------------------------------------------------------ */

const THEMES: [string, string][] = [
  ["aleatorio", "Sortear"],
  ["lugares", "Lugares"],
  ["comidas", "Comidas"],
  ["animais", "Animais"],
  ["profissoes", "Profissões"],
  ["objetos", "Objetos"],
  ["esportes", "Esportes"],
  ["games", "Games"],
  ["anime", "Anime"],
];
const STYLES: [string, string][] = [
  ["historico", "O que já tocou aqui"],
  ["sucessos", "Sucessos BR"],
  ["anime", "Aberturas de anime"],
  ["games", "Trilhas de games"],
  ["rock", "Rock"],
  ["funk", "Funk"],
  ["sertanejo", "Sertanejo"],
];

export function GamePicker({ channelId, onStarted }: { channelId: string; onStarted: () => void }) {
  const [kind, setKind] = useState<GameKind | null>(null);
  const [theme, setTheme] = useState("aleatorio");
  const [mode, setMode] = useState("sem_palavra");
  const [style, setStyle] = useState("historico");
  const [world, setWorld] = useState("onde");
  const [busy, setBusy] = useState(false);
  const list: { id: GameKind; icon: React.ReactNode; text: string }[] = [
    { id: "impostor", icon: <VenetianMask />, text: "Todo mundo recebe a palavra, menos o impostor. Cada um fala uma dica e vocês votam para expulsar. 3+ pessoas." },
    { id: "forca", icon: <Spline />, text: "Forca em grupo: qualquer um chuta letra, as vidas são de todos." },
    { id: "quina", icon: <Grid3x3 />, text: "Palavra de 5 letras em 6 tentativas, todo mundo no mesmo tabuleiro. Acertou, vem outra. Sem fim." },
    { id: "musica", icon: <Music2 />, text: "Toca um trecho; quem escrever o nome primeiro leva mais pontos." },
    { id: "mundo", icon: <Globe2 />, text: "Aparece uma foto de algum lugar do mundo: marque no mapa onde foi. No modo difícil, chute o ano também." },
  ];
  const start = async () => {
    if (!kind) return;
    setBusy(true);
    try {
      await api(`/calls/${channelId}/minigame`, {
        json: { kind, theme, mode: kind === "mundo" ? world : mode, style, rounds: kind === "mundo" ? 5 : kind === "musica" ? 8 : undefined },
      });
      onStarted();
    } catch (e) {
      toast(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  const chip = (on: boolean) => `press rounded-full px-3 py-1 text-[13px] font-semibold ${on ? "bg-oat text-cocoa-0" : "bg-cocoa-3 text-oat/70 hover:bg-cocoa-4"}`;
  return (
    <div className="pop-in w-[min(440px,calc(100vw-16px))] rounded-[18px] bg-cocoa-0 p-4">
      <p className="label mb-3 text-ember">Minigames</p>
      {!kind ? (
        <div className="space-y-1.5">
          {list.map((g) => (
            <button key={g.id} type="button" onClick={() => setKind(g.id)} className="press flex w-full items-start gap-3 rounded-[14px] bg-cocoa-3 p-3 text-left hover:bg-cocoa-4">
              <span className="grid size-10 shrink-0 place-items-center rounded-[12px] bg-ember text-white [&_svg]:size-5">{g.icon}</span>
              <span>
                <span className="block font-display text-[18px] font-semibold leading-tight">{GAME_TITLES[g.id]}</span>
                <span className="text-[13px] text-oat/55">{g.text}</span>
              </span>
            </button>
          ))}
        </div>
      ) : (
        <div className="space-y-3">
          <p className="font-display text-[20px] font-semibold">{GAME_TITLES[kind]}</p>
          {(kind === "impostor" || kind === "forca") && (
            <div>
              <p className="mb-1.5 text-[12.5px] font-semibold text-oat/55">Tema</p>
              <div className="flex flex-wrap gap-1.5">
                {THEMES.map(([id, label]) => (
                  <button key={id} type="button" className={chip(theme === id)} onClick={() => setTheme(id)}>
                    {label}
                  </button>
                ))}
              </div>
            </div>
          )}
          {kind === "impostor" && (
            <div>
              <p className="mb-1.5 text-[12.5px] font-semibold text-oat/55">Modo</p>
              <div className="flex flex-wrap gap-1.5">
                <button type="button" className={chip(mode === "sem_palavra")} onClick={() => setMode("sem_palavra")}>
                  Impostor sem palavra
                </button>
                <button type="button" className={chip(mode === "palavra_diferente")} onClick={() => setMode("palavra_diferente")}>
                  Impostor com outra palavra
                </button>
              </div>
              <p className="mt-1.5 text-[12.5px] text-oat/45">
                {mode === "sem_palavra" ? "O impostor sabe que é o impostor e tenta disfarçar." : "O impostor recebe uma palavra parecida e nem sabe que é o impostor."}
              </p>
            </div>
          )}
          {kind === "musica" && (
            <div>
              <p className="mb-1.5 text-[12.5px] font-semibold text-oat/55">Músicas</p>
              <div className="flex flex-wrap gap-1.5">
                {STYLES.map(([id, label]) => (
                  <button key={id} type="button" className={chip(style === id)} onClick={() => setStyle(id)}>
                    {label}
                  </button>
                ))}
              </div>
            </div>
          )}
          {kind === "mundo" && (
            <div>
              <p className="mb-1.5 text-[12.5px] font-semibold text-oat/55">Modo</p>
              <div className="flex flex-wrap gap-1.5">
                <button type="button" className={chip(world === "onde")} onClick={() => setWorld("onde")}>
                  Onde
                </button>
                <button type="button" className={chip(world === "quando")} onClick={() => setWorld("quando")}>
                  Onde e quando (difícil)
                </button>
              </div>
              <p className="mt-1.5 text-[12.5px] text-oat/45">Fotos livres do Wikimedia Commons; o crédito de cada uma aparece no fim da rodada.</p>
            </div>
          )}
          <div className="flex justify-between gap-2 pt-1">
            <button type="button" className="press rounded-[12px] px-3 py-2 text-[14px] font-semibold text-oat/60 hover:bg-cocoa-3" onClick={() => setKind(null)}>
              Voltar
            </button>
            <button type="button" disabled={busy} className="press rounded-[12px] bg-ember px-4 py-2 text-[14px] font-semibold text-white disabled:opacity-50" onClick={() => void start()}>
              {busy ? "Começando…" : "Começar"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* o palco do jogo                                                      */
/* ------------------------------------------------------------------ */

export function GameStage({ channelId, game, onClose }: { channelId: string; game: GameView; onClose: () => void }) {
  const me = useStore((s) => s.me?.id ?? "");
  const left = useCountdown(game.ends_at);
  const name = useCallback((id: string) => nameInChannel(channelId, id, "Alguém"), [channelId]);
  const board = Object.entries(game.score)
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6);
  const end = async () => {
    try {
      await api(`/calls/${channelId}/minigame`, { method: "DELETE" });
      onClose();
    } catch (e) {
      toast(errorText(e));
    }
  };
  return (
    <div className="absolute inset-0 flex flex-col overflow-hidden bg-cocoa-1">
      <header className="flex shrink-0 items-center gap-3 border-b border-white/5 px-4 py-2.5">
        <p className="font-display text-[18px] font-semibold">{GAME_TITLES[game.kind]}</p>
        {left !== null && (
          <span className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-[13px] font-semibold tabular-nums ${left <= 10 ? "bg-ember/20 text-ember-2" : "bg-cocoa-3 text-oat/70"}`}>
            <Timer className="size-3.5" />
            {left}s
          </span>
        )}
        <div className="ml-auto flex min-w-0 items-center gap-1.5 overflow-x-auto">
          {board.map(([id, n], i) => (
            <span key={id} className="flex shrink-0 items-center gap-1 rounded-full bg-cocoa-3 px-2 py-0.5 text-[12.5px]">
              {i === 0 && <Crown className="size-3.5 text-amber-300" />}
              <span className="max-w-24 truncate">{name(id)}</span>
              <b className="tabular-nums">{n}</b>
            </span>
          ))}
        </div>
        <button type="button" onClick={() => void end()} className="press shrink-0 rounded-[10px] px-2 py-1 text-[13px] font-semibold text-oat/55 hover:bg-cocoa-3 hover:text-oat" title="Encerrar o jogo">
          Encerrar
        </button>
      </header>
      {game.notice && <p className="shrink-0 bg-ember/15 px-4 py-1.5 text-[13.5px] text-ember-2">{game.notice}</p>}
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {game.phase === "loading" ? (
          <p className="grid h-full place-items-center text-oat/60">Preparando o jogo…</p>
        ) : game.kind === "impostor" ? (
          <ImpostorView channelId={channelId} g={game} me={me} name={name} />
        ) : game.kind === "forca" ? (
          <ForcaView channelId={channelId} g={game} />
        ) : game.kind === "quina" ? (
          <QuinaView channelId={channelId} g={game} name={name} />
        ) : game.kind === "musica" ? (
          <MusicaView channelId={channelId} g={game} name={name} />
        ) : (
          <MundoView channelId={channelId} g={game} me={me} name={name} />
        )}
      </div>
    </div>
  );
}

const btn = "press rounded-[12px] px-4 py-2 text-[14px] font-semibold";

/* ---------------- Impostor ---------------- */
function ImpostorView({ channelId, g, me, name }: { channelId: string; g: GameView; me: string; name: (id: string) => string }) {
  const card = g.card as { impostor?: boolean; word?: string } | undefined;
  const alive = (g.alive as string[]) ?? [];
  const order = (g.order as string[]) ?? [];
  const voted = new Set((g.voted as string[]) ?? []);
  const result = g.result as { text?: string } | null;
  const [guess, setGuess] = useState("");
  const [hide, setHide] = useState(false);
  const iAmAlive = alive.includes(me);
  return (
    <div className="mx-auto flex max-w-xl flex-col items-center gap-4 text-center">
      <p className="text-[13px] font-semibold text-oat/55">
        Tema: {String(g.theme)} · {Number(g.impostor_count) > 1 ? `${String(g.impostor_count)} impostores` : "1 impostor"}
      </p>
      {card && g.phase !== "end" && (
        <button type="button" onClick={() => setHide((h) => !h)} className="press w-full max-w-sm rounded-[18px] bg-cocoa-3 px-6 py-6 hover:bg-cocoa-4" title="Clique para esconder ou mostrar">
          {hide ? (
            <span className="text-oat/50">Carta escondida (clique para ver)</span>
          ) : card.impostor ? (
            <span className="block font-display text-[30px] font-bold text-ember-2">Você é o impostor 🤫</span>
          ) : (
            <>
              <span className="block text-[13px] text-oat/50">Sua palavra</span>
              <span className="block font-display text-[34px] font-bold">{card.word}</span>
            </>
          )}
        </button>
      )}
      {result?.text && <p className="rounded-[12px] bg-cocoa-3 px-4 py-2 text-[14.5px]">{result.text}</p>}

      {g.phase === "talk" && (
        <>
          <p className="text-[14px] text-oat/70">Cada um fala uma dica sobre a palavra, nesta ordem:</p>
          <ol className="flex flex-wrap justify-center gap-1.5">
            {order.map((id, i) => (
              <li key={id} className="rounded-full bg-cocoa-3 px-3 py-1 text-[13.5px]">
                {i + 1}. {name(id)}
              </li>
            ))}
          </ol>
          {iAmAlive && (
            <button type="button" className={`${btn} bg-ember text-white`} onClick={() => void act(channelId, { action: "votacao" })}>
              Chamar a votação
            </button>
          )}
        </>
      )}

      {g.phase === "vote" && (
        <>
          <p className="text-[14px] text-oat/70">
            Quem é o impostor? ({voted.size}/{alive.length} votaram)
          </p>
          <div className="flex flex-wrap justify-center gap-2">
            {alive
              .filter((id) => id !== me)
              .map((id) => (
                <button key={id} type="button" disabled={!iAmAlive} className={`${btn} bg-cocoa-3 hover:bg-cocoa-4 disabled:opacity-50`} onClick={() => void act(channelId, { action: "voto", target: id })}>
                  {name(id)}
                  {voted.has(id) && <Check className="ml-1 inline size-3.5 text-emerald-400" />}
                </button>
              ))}
            <button type="button" disabled={!iAmAlive} className={`${btn} text-oat/60 hover:bg-cocoa-3 disabled:opacity-50`} onClick={() => void act(channelId, { action: "voto", target: "pular" })}>
              Pular
            </button>
          </div>
          {!iAmAlive && <p className="text-[13px] text-oat/45">Você saiu da rodada: só assiste.</p>}
        </>
      )}

      {g.phase === "guess" &&
        (g.guesser === me ? (
          <form
            className="flex w-full max-w-sm gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (guess.trim()) void act(channelId, { action: "chute", text: guess.trim() });
            }}
          >
            <input value={guess} onChange={(e) => setGuess(e.target.value)} maxLength={60} placeholder="Qual era a palavra?" className="min-w-0 flex-1 rounded-[12px] bg-cocoa-3 px-3 py-2 outline-none" autoFocus />
            <button type="submit" className={`${btn} bg-ember text-white`}>
              Chutar
            </button>
          </form>
        ) : (
          <p className="text-[14px] text-oat/70">{name(String(g.guesser))} está tentando adivinhar a palavra…</p>
        ))}

      {g.phase === "end" && (
        <>
          <p className="font-display text-[26px] font-bold">{g.winner === "impostor" ? "O impostor venceu! 🎭" : "A turma venceu! 🎉"}</p>
          <p className="text-[14.5px]">
            A palavra era <b>{String(g.word)}</b>
            {g.alt ? (
              <>
                {" "}
                (o impostor tinha <b>{String(g.alt)}</b>)
              </>
            ) : null}
            . Impostor: <b>{((g.impostors as string[]) ?? []).map(name).join(", ")}</b>
          </p>
          <button type="button" className={`${btn} bg-ember text-white`} onClick={() => void act(channelId, { action: "nova" })}>
            Nova rodada
          </button>
        </>
      )}
    </div>
  );
}

/* ---------------- Forca ---------------- */
const ABC = "abcdefghijklmnopqrstuvwxyz".split("");

function ForcaView({ channelId, g }: { channelId: string; g: GameView }) {
  const hits = new Set((g.hits as string[]) ?? []);
  const misses = new Set((g.misses as string[]) ?? []);
  const [word, setWord] = useState("");
  const lives = Number(g.lives);
  return (
    <div className="mx-auto flex max-w-2xl flex-col items-center gap-4 text-center">
      <p className="text-[13px] font-semibold text-oat/55">Tema: {String(g.theme)}</p>
      <p className="text-[22px]" aria-label={`${lives} vidas`}>
        {"❤️".repeat(Math.max(0, lives))}
        {"🖤".repeat(Math.max(0, 6 - lives))}
      </p>
      <p className="font-mono text-[30px] font-bold tracking-[0.3em] sm:text-[38px]">{String(g.mask).replace(/ /g, "  ")}</p>
      {g.phase === "end" ? (
        <>
          <p className="font-display text-[22px] font-bold">{g.solved ? "Acertaram! 🎉" : "Enforcados 💀"}</p>
          <button type="button" className={`${btn} bg-ember text-white`} onClick={() => void act(channelId, { action: "nova" })}>
            Próxima palavra
          </button>
        </>
      ) : (
        <>
          <div className="flex max-w-lg flex-wrap justify-center gap-1.5">
            {ABC.map((l) => (
              <button
                key={l}
                type="button"
                disabled={hits.has(l) || misses.has(l)}
                onClick={() => void act(channelId, { action: "letra", text: l })}
                className={`press size-9 rounded-[10px] text-[15px] font-bold uppercase ${hits.has(l) ? "bg-emerald-600/70 text-white" : misses.has(l) ? "bg-cocoa-2 text-oat/25" : "bg-cocoa-3 hover:bg-cocoa-4"}`}
              >
                {l}
              </button>
            ))}
          </div>
          <form
            className="flex w-full max-w-sm gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (word.trim()) void act(channelId, { action: "palavra", text: word.trim() }).then(() => setWord(""));
            }}
          >
            <input value={word} onChange={(e) => setWord(e.target.value)} maxLength={60} placeholder="Chutar a palavra inteira (erro = 2 vidas)" className="min-w-0 flex-1 rounded-[12px] bg-cocoa-3 px-3 py-2 text-[14px] outline-none" />
            <button type="submit" className={`${btn} bg-cocoa-3 hover:bg-cocoa-4`}>
              Chutar
            </button>
          </form>
        </>
      )}
    </div>
  );
}

/* ---------------- Quina ---------------- */
const MARK = ["bg-cocoa-3 text-oat/60", "bg-amber-500 text-cocoa-0", "bg-emerald-600 text-white"];

function QuinaView({ channelId, g, name }: { channelId: string; g: GameView; name: (id: string) => string }) {
  const rows = useMemo(() => (g.rows as { by: string; word: string; marks: number[] }[]) ?? [], [g.rows]);
  const tries = Number(g.tries) || 6;
  const [text, setText] = useState("");
  const keys = useMemo(() => {
    const k: Record<string, number> = {};
    for (const r of rows) r.word.split("").forEach((c, i) => (k[c] = Math.max(k[c] ?? -1, r.marks[i])));
    return k;
  }, [rows]);
  const send = () => {
    const w = text.trim();
    if (w.length !== 5) return toast("A palavra tem 5 letras.");
    void act(channelId, { action: "chute", text: w }).then((r) => r && setText(""));
  };
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-3">
      <p className="text-[13px] font-semibold text-oat/55">
        Sequência: {String(g.streak)} · Recorde: {String(g.best)}
      </p>
      <div className="grid gap-1.5">
        {Array.from({ length: tries }).map((_, i) => {
          const r = rows[i];
          return (
            <div key={i} className="flex items-center gap-1.5">
              {Array.from({ length: 5 }).map((__, j) => (
                <span key={j} className={`grid size-11 place-items-center rounded-[8px] font-display text-[22px] font-bold uppercase sm:size-12 ${r ? MARK[r.marks[j]] : "border border-white/10"}`}>
                  {r?.word[j] ?? ""}
                </span>
              ))}
              <span className="w-20 truncate text-[12px] text-oat/45">{r ? name(r.by) : ""}</span>
            </div>
          );
        })}
      </div>
      {g.phase === "end" ? (
        <p className="text-center font-display text-[20px] font-bold">
          {g.solved ? "Acertaram!" : "Não foi dessa vez."} Era <span className="uppercase text-ember-2">{String(g.word)}</span>. Vem outra…
        </p>
      ) : (
        <form
          className="flex w-full gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
        >
          <input
            value={text}
            onChange={(e) => setText(e.target.value.replace(/[^a-zA-ZÀ-ÿ]/g, "").slice(0, 5))}
            placeholder="5 letras"
            className="min-w-0 flex-1 rounded-[12px] bg-cocoa-3 px-3 py-2 text-center font-display text-[18px] uppercase tracking-[0.3em] outline-none"
            autoFocus
          />
          <button type="submit" className={`${btn} bg-ember text-white`}>
            Chutar
          </button>
        </form>
      )}
      <div className="flex max-w-md flex-wrap justify-center gap-1">
        {ABC.map((l) => (
          <span key={l} className={`grid h-7 w-6 place-items-center rounded-[6px] text-[12px] font-bold uppercase ${keys[l] === undefined ? "bg-cocoa-3/60" : keys[l] === 0 ? "bg-cocoa-2 text-oat/25" : MARK[keys[l]]}`}>
            {l}
          </span>
        ))}
      </div>
    </div>
  );
}

/* ---------------- Adivinhe a música ---------------- */
function MusicaView({ channelId, g, name }: { channelId: string; g: GameView; name: (id: string) => string }) {
  const [text, setText] = useState("");
  const [miss, setMiss] = useState(false);
  const videoId = typeof g.video_id === "string" && /^[A-Za-z0-9_-]{11}$/.test(g.video_id) ? g.video_id : undefined;
  const answer = g.answer as { title: string; author: string } | undefined;
  const got = (g.got as string[]) ?? [];
  const start = Math.max(0, Math.floor(Number(g.start) || 0));
  return (
    <div className="mx-auto flex max-w-lg flex-col items-center gap-4 text-center">
      <p className="text-[13px] font-semibold text-oat/55">
        Música {String(g.round)} de {String(g.rounds)}
      </p>
      {/* o trecho toca escondido: o título só aparece no fim da rodada */}
      {g.phase === "play" && videoId && (
        <iframe
          key={`${videoId}-${String(g.round)}`}
          title="trecho"
          aria-hidden
          tabIndex={-1}
          allow="autoplay"
          className="pointer-events-none absolute -left-[9999px] size-px opacity-0"
          src={`https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1&controls=0&start=${start}&end=${start + 30}`}
        />
      )}
      {g.phase === "play" && (
        <>
          <p className="text-[48px]">🎧</p>
          {g.you_got ? (
            <p className="font-display text-[20px] font-bold text-emerald-400">Você acertou! Espere os outros…</p>
          ) : (
            <form
              className="flex w-full gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (!text.trim()) return;
                void act(channelId, { action: "chute", text: text.trim() }).then((r) => {
                  if (r && r.ok === false) {
                    setMiss(true);
                    window.setTimeout(() => setMiss(false), 900);
                  }
                  setText("");
                });
              }}
            >
              <input
                value={text}
                onChange={(e) => setText(e.target.value)}
                maxLength={80}
                placeholder="Nome da música"
                className={`min-w-0 flex-1 rounded-[12px] bg-cocoa-3 px-3 py-2 outline-none ${miss ? "ring-2 ring-ember" : ""}`}
                autoFocus
              />
              <button type="submit" className={`${btn} bg-ember text-white`}>
                Chutar
              </button>
            </form>
          )}
          <p className="text-[13px] text-oat/50">Sem som? Clique uma vez em qualquer lugar da página (o navegador segura o som automático).</p>
        </>
      )}
      {answer && (
        <div className="rounded-[14px] bg-cocoa-3 px-5 py-3">
          <p className="text-[12.5px] text-oat/50">Era</p>
          <p className="font-display text-[20px] font-bold">{answer.title}</p>
          <p className="text-[13px] text-oat/60">{answer.author}</p>
        </div>
      )}
      {got.length > 0 && <p className="text-[13.5px] text-oat/70">Acertaram: {got.map(name).join(", ")}</p>}
      {g.phase === "end" && <p className="font-display text-[22px] font-bold">Fim de jogo! 🏁</p>}
    </div>
  );
}

/* ---------------- Onde foi isso? ---------------- */
interface Pin {
  user_id: string;
  lat: number;
  lon: number;
  year: number | null;
  km: number;
  points: number;
}

function usePhoto(path: string | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!path || !/^\/calls\/\d+\/minigame\/foto\/[\w-]+\/\d+$/.test(path)) return;
    let alive = true;
    let made: string | null = null;
    // a foto exige login (e estar na call): baixa com o token e mostra como blob
    void (async () => {
      try {
        const { API_URL, getToken } = await import("@/lib/api");
        const token = getToken();
        const r = await fetch(API_URL + path, { headers: token ? { Authorization: `Bearer ${token}` } : {}, credentials: "include" });
        if (!r.ok || !alive) return;
        made = URL.createObjectURL(await r.blob());
        setUrl(made);
      } catch {
        /* sem foto: a rodada segue */
      }
    })();
    return () => {
      alive = false;
      if (made) URL.revokeObjectURL(made);
      setUrl(null);
    };
  }, [path]);
  return url;
}

function MundoView({ channelId, g, me, name }: { channelId: string; g: GameView; me: string; name: (id: string) => string }) {
  const photo = usePhoto(g.image as string | undefined);
  const withYear = !!g.with_year;
  const mine = g.mine as { lat: number; lon: number; year: number | null } | undefined;
  const ans = g.answer as { lat: number; lon: number; year: number | null; artist: string; license: string; page: string } | undefined;
  const results = useMemo(() => (g.results as Pin[]) ?? [], [g.results]);
  const round = Number(g.round);
  // o pino vale só para a rodada em que foi posto (rodada nova = mapa limpo)
  const [picked, setPicked] = useState<{ round: number; at: [number, number] } | null>(null);
  const pin = picked && picked.round === round ? picked.at : null;
  const [year, setYear] = useState(1990);
  const thisYear = new Date().getFullYear();
  const answer = useMemo<[number, number] | null>(() => (ans ? [ans.lat, ans.lon] : null), [ans]);
  const shown = useMemo<[number, number] | null>(() => (g.phase === "play" ? (pin ?? (mine ? [mine.lat, mine.lon] : null)) : null), [g.phase, pin, mine]);
  const others = useMemo(
    () => (g.phase !== "play" ? results.map((r) => ({ lat: r.lat, lon: r.lon, label: `${name(r.user_id)}: ${r.points}`, me: r.user_id === me })) : []),
    [g.phase, results, name, me],
  );
  return (
    <div className="grid h-full min-h-[420px] gap-3 lg:grid-cols-2">
      <div className="relative min-h-[220px] overflow-hidden rounded-[14px] bg-black">
        {photo ? (
          // blob: local, já baixado com login; o <img> do Next não serve aqui
          // eslint-disable-next-line @next/next/no-img-element
          <img src={photo} alt="Foto da rodada" className="absolute inset-0 size-full object-contain" />
        ) : (
          <p className="grid h-full place-items-center text-oat/50">Carregando foto…</p>
        )}
        <span className="absolute left-2 top-2 rounded-full bg-black/60 px-2 py-0.5 text-[12px]">
          Foto {round} de {String(g.rounds)}
        </span>
      </div>
      <div className="flex min-h-[260px] flex-col gap-2">
        <WorldMap className="min-h-[220px] flex-1" pin={shown} onPick={g.phase === "play" ? (lat, lon) => setPicked({ round, at: [lat, lon] }) : undefined} answer={answer} others={others} />
        {g.phase === "play" && (
          <div className="flex flex-wrap items-center gap-2">
            {withYear && (
              <label className="flex flex-1 items-center gap-2 text-[13.5px]">
                Ano
                <input type="range" min={1850} max={thisYear} value={year} onChange={(e) => setYear(Number(e.target.value))} className="flex-1 accent-ember" />
                <b className="w-12 tabular-nums">{year}</b>
              </label>
            )}
            <button
              type="button"
              disabled={!pin}
              className={`${btn} bg-ember text-white disabled:opacity-40`}
              onClick={() => pin && void act(channelId, { action: "chute", lat: pin[0], lon: pin[1], year: withYear ? year : undefined })}
            >
              {mine ? "Mudar chute" : "Confirmar"}
            </button>
            <span className="text-[12.5px] text-oat/50">{((g.guessed as string[]) ?? []).length} já chutaram</span>
          </div>
        )}
        {ans && (
          <div className="rounded-[12px] bg-cocoa-3 p-3 text-[13.5px]">
            {ans.year && (
              <p>
                Ano: <b>{ans.year}</b>
              </p>
            )}
            <ol className="mt-1 space-y-0.5">
              {results.map((r) => (
                <li key={r.user_id} className="flex justify-between gap-2">
                  <span className="truncate">{name(r.user_id)}</span>
                  <span className="tabular-nums text-oat/70">
                    {r.km.toLocaleString("pt-BR")} km{r.year ? ` · ${r.year}` : ""} · <b className="text-oat">{r.points}</b>
                  </span>
                </li>
              ))}
            </ol>
            <p className="mt-2 text-[11.5px] text-oat/45">
              Foto: {ans.artist}
              {ans.license ? ` (${ans.license})` : ""} ·{" "}
              {/^https:\/\/commons\.wikimedia\.org\//.test(ans.page) ? (
                <a href={ans.page} target="_blank" rel="noreferrer noopener" className="underline">
                  Wikimedia Commons
                </a>
              ) : (
                "Wikimedia Commons"
              )}
            </p>
            {g.phase === "reveal" && (
              <button type="button" className={`${btn} mt-2 bg-cocoa-4`} onClick={() => void act(channelId, { action: "proxima" })}>
                Próxima foto
              </button>
            )}
          </div>
        )}
        {g.phase === "end" && <p className="font-display text-[22px] font-bold">Fim de jogo! 🏁</p>}
      </div>
    </div>
  );
}

/** Mapa-múndi (OpenStreetMap via Leaflet). Carrega só quando o jogo abre. */
function WorldMap({
  className,
  pin,
  onPick,
  answer,
  others,
}: {
  className?: string;
  pin: [number, number] | null;
  onPick?: (lat: number, lon: number) => void;
  answer: [number, number] | null;
  others: { lat: number; lon: number; label: string; me: boolean }[];
}) {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<import("leaflet").Map | null>(null);
  const layer = useRef<import("leaflet").LayerGroup | null>(null);
  const lib = useRef<typeof import("leaflet") | null>(null);
  const pick = useRef(onPick);
  useEffect(() => {
    pick.current = onPick;
  }, [onPick]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let dead = false;
    void (async () => {
      const leaflet = await import("leaflet");
      await import("leaflet/dist/leaflet.css");
      if (dead || !box.current) return;
      lib.current = leaflet;
      const m = leaflet.map(box.current, { worldCopyJump: true, minZoom: 1 }).setView([15, 0], 1);
      leaflet
        .tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
          maxZoom: 18,
          attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a>',
        })
        .addTo(m);
      m.on("click", (e: import("leaflet").LeafletMouseEvent) => {
        const ll = e.latlng.wrap();
        pick.current?.(ll.lat, ll.lng);
      });
      map.current = m;
      layer.current = leaflet.layerGroup().addTo(m);
      setReady(true);
    })();
    return () => {
      dead = true;
      map.current?.remove();
      map.current = null;
    };
  }, []);

  useEffect(() => {
    const leaflet = lib.current;
    const group = layer.current;
    if (!ready || !leaflet || !group) return;
    group.clearLayers();
    const dot = (color: string, size = 14) =>
      leaflet.divIcon({ className: "", iconSize: [size, size], html: `<span style="display:block;width:${size}px;height:${size}px;border-radius:50%;background:${color};border:2px solid #fff;box-shadow:0 1px 4px #0008"></span>` });
    if (pin) leaflet.marker(pin, { icon: dot("#e8743b", 16) }).addTo(group);
    if (answer) {
      leaflet.marker(answer, { icon: dot("#22c55e", 18) }).addTo(group).bindTooltip("Aqui!", { permanent: true, direction: "top" });
      for (const o of others) {
        // o nome vai como texto puro (o Leaflet trata string como HTML): escapa antes
        const label = o.label.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
        leaflet.marker([o.lat, o.lon], { icon: dot(o.me ? "#e8743b" : "#60a5fa") }).addTo(group).bindTooltip(label);
        leaflet.polyline([[o.lat, o.lon], answer], { color: "#ffffff88", weight: 1.5, dashArray: "4 4" }).addTo(group);
      }
      map.current?.fitBounds(leaflet.latLngBounds([answer, ...others.map((o) => [o.lat, o.lon] as [number, number])]).pad(0.3), { maxZoom: 6 });
    }
  }, [ready, pin, answer, others]);

  return <div ref={box} className={`overflow-hidden rounded-[14px] bg-cocoa-3 ${className ?? ""}`} style={{ cursor: onPick ? "crosshair" : undefined }} />;
}
