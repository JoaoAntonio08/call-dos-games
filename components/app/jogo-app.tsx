"use client";

import { useEffect, useState } from "react";
import { Gamepad2, Plus, Trash2 } from "lucide-react";
import { api } from "@/lib/api";
import { useStore } from "@/lib/store";
import { toast } from "@/lib/ui";
import { Section, Toggle } from "./bits";

/* ------------------------------------------------------------------ */
/* "Jogando X" sem Steam: o app de Windows vê qual jogo está aberto     */
/* ------------------------------------------------------------------ */

interface DesktopGames {
  onGame?: (cb: (name: string | null) => void) => () => void;
  gameCandidates?: () => Promise<{ exe: string; title: string }[]>;
  customGames?: (list?: { exe: string; name: string }[]) => Promise<{ exe: string; name: string }[]>;
}

const desktop = (): DesktopGames | undefined => (typeof window === "undefined" ? undefined : (window as unknown as { cdgDesktop?: DesktopGames }).cdgDesktop);

const PREF = "cdg:jogo-auto";
const prefOn = () => {
  try {
    return localStorage.getItem(PREF) !== "0";
  } catch {
    return true;
  }
};

let lastSent: string | null | undefined;
let detected: string | null = null;
const listeners = new Set<(g: string | null) => void>();

async function report(force = false) {
  const want = prefOn() ? detected : null;
  if (!force && want === lastSent) return;
  try {
    await api("/me/game", { method: "PUT", json: { name: want } });
    lastSent = want;
  } catch {
    /* tenta de novo na próxima */
  }
}

/** Fica ligado no app inteiro: manda o jogo aberto no PC (se a pessoa deixar). */
export function GameReporter() {
  const me = useStore((s) => s.me);
  useEffect(() => {
    const d = desktop();
    if (!me || !d?.onGame) return;
    lastSent = undefined;
    const off = d.onGame((name) => {
      detected = name || null;
      for (const l of listeners) l(detected);
      void report();
    });
    // a conexão pode cair e voltar (o servidor esquece o jogo): reenvia de vez em quando
    const t = window.setInterval(() => void report(true), 120_000);
    return () => {
      off();
      window.clearInterval(t);
    };
  }, [me]);
  return null;
}

/** Configurações → Jogos, só no app de Windows. */
export function DesktopGameSettings() {
  const d = desktop();
  const [on, setOn] = useState(prefOn);
  const [now, setNow] = useState<string | null>(detected);
  const [custom, setCustom] = useState<{ exe: string; name: string }[]>([]);
  const [picking, setPicking] = useState<{ exe: string; title: string }[] | null>(null);
  const [choice, setChoice] = useState<{ exe: string; name: string } | null>(null);

  useEffect(() => {
    listeners.add(setNow);
    void d?.customGames?.().then(setCustom, () => {});
    return () => {
      listeners.delete(setNow);
    };
  }, [d]);

  if (!d) return null;
  if (!d.onGame || !d.customGames || !d.gameCandidates) {
    return (
      <Section title="Jogo aberto no PC">
        <p className="text-[13.5px] text-oat/55">Atualize o app de Windows para ele mostrar sozinho o jogo que você está jogando.</p>
      </Section>
    );
  }

  async function saveCustom(list: { exe: string; name: string }[]) {
    try {
      setCustom(await d!.customGames!(list));
    } catch {
      toast("Não deu para salvar a lista de jogos.");
    }
  }

  return (
    <Section
      title="Jogo aberto no PC"
      hint="O app de Windows olha só o nome dos programas abertos e mostra “Jogando X” para a turma quando reconhece um jogo. Se a Steam estiver ligada, ela tem preferência."
    >
      <label className="flex items-center justify-between gap-4 py-1">
        <span className="text-[14.5px] font-medium">Mostrar o jogo que estou jogando</span>
        <Toggle
          checked={on}
          onChange={(x) => {
            setOn(x);
            try {
              localStorage.setItem(PREF, x ? "1" : "0");
            } catch {
              /* sem armazenamento */
            }
            void report();
          }}
          label="Mostrar o jogo que estou jogando"
        />
      </label>
      <p className="mt-2 flex items-center gap-2 text-[13px] text-oat/60">
        <Gamepad2 className="size-4 text-moss" />
        {now ? `Agora: ${now}` : "Nenhum jogo reconhecido aberto agora."}
      </p>

      {custom.length > 0 && (
        <ul className="mt-4 space-y-1.5">
          {custom.map((g) => (
            <li key={g.exe} className="flex items-center gap-3 rounded-[12px] bg-cocoa-3 px-3 py-2">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[14px] font-semibold">{g.name}</span>
                <span className="block truncate text-[12px] text-oat/45">{g.exe}</span>
              </span>
              <button
                type="button"
                className="grid size-8 place-items-center rounded-[9px] text-oat/50 hover:bg-rust hover:text-oat"
                aria-label={`Tirar ${g.name}`}
                onClick={() => void saveCustom(custom.filter((c) => c.exe !== g.exe))}
              >
                <Trash2 className="size-4" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {choice ? (
        <form
          className="mt-4 flex flex-wrap gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!choice.name.trim()) return;
            void saveCustom([...custom.filter((c) => c.exe !== choice.exe), { exe: choice.exe, name: choice.name.trim() }]);
            setChoice(null);
            setPicking(null);
          }}
        >
          <input
            className="field min-w-[200px] flex-1"
            value={choice.name}
            onChange={(e) => setChoice({ ...choice, name: e.target.value })}
            aria-label="Nome do jogo"
            maxLength={80}
            autoFocus
          />
          <button type="submit" className="btn-ember h-[46px] px-4 text-[14px]" disabled={!choice.name.trim()}>
            Salvar
          </button>
          <button type="button" className="btn-quiet h-[46px] px-4 text-[14px]" onClick={() => setChoice(null)}>
            Voltar
          </button>
        </form>
      ) : picking ? (
        <div className="mt-4">
          <p className="mb-2 text-[13px] text-oat/60">Abra o jogo e escolha a janela dele:</p>
          <ul className="max-h-64 space-y-1 overflow-y-auto">
            {picking.map((p) => (
              <li key={p.exe}>
                <button
                  type="button"
                  className="w-full rounded-[10px] px-3 py-2 text-left hover:bg-oat/[0.06]"
                  onClick={() => setChoice({ exe: p.exe, name: p.title.replace(/\s+[-–—|].*$/, "").slice(0, 80) })}
                >
                  <span className="block truncate text-[14px]">{p.title}</span>
                  <span className="block truncate text-[12px] text-oat/45">{p.exe}</span>
                </button>
              </li>
            ))}
            {picking.length === 0 && <li className="px-3 py-2 text-[13px] text-oat/50">Nenhuma janela aberta encontrada.</li>}
          </ul>
          <button type="button" className="btn-quiet mt-2 h-9 px-3.5 text-[13.5px]" onClick={() => setPicking(null)}>
            Cancelar
          </button>
        </div>
      ) : (
        <button
          type="button"
          className="btn-quiet mt-4 inline-flex h-9 items-center gap-2 px-3.5 text-[13.5px]"
          onClick={async () => {
            try {
              setPicking(await d.gameCandidates!());
            } catch {
              toast("Não deu para ver as janelas abertas.");
            }
          }}
        >
          <Plus className="size-4" /> Adicionar jogo que não foi reconhecido
        </button>
      )}
    </Section>
  );
}

/* ------------------------------------------------------------------ */
/* App de Windows: abrir com o Windows e continuar em segundo plano     */
/* ------------------------------------------------------------------ */

type AppPrefs = { startup: boolean; hidden: boolean; background: boolean };
type DesktopApp = { appPrefs?: (patch?: Partial<AppPrefs>) => Promise<AppPrefs> };
const desktopApp = (): DesktopApp | undefined =>
  typeof window === "undefined" ? undefined : (window as unknown as { cdgDesktop?: DesktopApp }).cdgDesktop;

/** Só aparece dentro do app de Windows. */
export function hasDesktopApp() {
  return !!desktopApp();
}

export function DesktopAppSettings() {
  const d = desktopApp();
  const [p, setP] = useState<AppPrefs | null>(null);
  useEffect(() => {
    void d?.appPrefs?.().then(setP, () => {});
  }, [d]);
  if (!d) return null;
  if (!d.appPrefs) {
    return (
      <Section title="App de Windows">
        <p className="text-[13.5px] text-oat/55">Atualize o app de Windows para poder abrir junto com o Windows e deixar a call rodando em segundo plano.</p>
      </Section>
    );
  }
  if (!p) return null;
  const save = async (patch: Partial<AppPrefs>) => {
    setP({ ...p, ...patch });
    try {
      setP(await d.appPrefs!(patch));
    } catch {
      toast("Não deu para salvar essa opção do app.");
    }
  };
  const row = (label: string, hint: string, key: keyof AppPrefs, disabled = false) => (
    <label className={`flex items-center justify-between gap-4 py-2 ${disabled ? "opacity-45" : ""}`}>
      <span>
        <span className="block text-[14.5px] font-medium">{label}</span>
        <span className="block text-[12.5px] text-oat/45">{hint}</span>
      </span>
      <Toggle checked={p[key]} onChange={(v) => void save({ [key]: v })} label={label} disabled={disabled} />
    </label>
  );
  return (
    <Section title="App de Windows">
      {row("Abrir junto com o Windows", "O app liga sozinho quando você entra no computador.", "startup")}
      {row("Abrir escondido", "Ao ligar com o Windows, fica só no ícone perto do relógio, sem abrir a janela.", "hidden", !p.startup)}
      {row(
        "Continuar rodando ao fechar",
        "O X esconde a janela e a call continua (você segue ouvindo e falando). Para fechar de vez: botão direito no ícone perto do relógio → Fechar de vez.",
        "background",
      )}
    </Section>
  );
}
