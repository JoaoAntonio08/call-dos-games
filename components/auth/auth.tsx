"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { API_READY, api, errorText, getToken, setToken } from "@/lib/api";
import { FormError } from "@/components/app/bits";
import { PendingNote } from "@/components/api-pending";

type Session = { token: string; user: unknown; new_account?: boolean };

function useNext() {
  const params = useSearchParams();
  const next = params.get("next") || "/app";
  // só caminhos internos, nada de redirecionar para fora
  return next.startsWith("/") && !next.startsWith("//") ? next : "/app";
}

/* ------------------------------------------------------------------ */
/* moldura das telas de conta                                          */
/* ------------------------------------------------------------------ */

const LINES = [
  "Puxa uma cadeira, a call já começou.",
  "Alguém traz a pipoca, o episódio é longo.",
  "O chefão do Elden Ring não vai se derrotar sozinho.",
  "A turma toda num lugar só, sem limite de tela.",
];

export function AuthFrame({ title, kicker, children }: { title: React.ReactNode; kicker: string; children: React.ReactNode }) {
  const [line, setLine] = useState(LINES[0]);
  useEffect(() => setLine(LINES[Math.floor(Math.random() * LINES.length)]), []);
  return (
    <main className="grid min-h-svh flex-1 lg:grid-cols-[1.1fr_1fr]">
      {/* lado do abajur */}
      <section className="relative hidden overflow-hidden bg-cocoa-0 p-10 lg:flex lg:flex-col lg:justify-between">
        <Link href="/" className="font-display text-[26px] leading-none text-oat hover:text-ember-2">
          Call dos Games
        </Link>
        <span aria-hidden className="pointer-events-none absolute -right-6 top-6 select-none font-display text-[420px] leading-none text-ember/[0.12]">
          &
        </span>
        <div className="relative max-w-[30ch]">
          <p className="font-display-wonk text-[clamp(40px,4.4vw,68px)] leading-[0.98] text-oat">“{line}”</p>
          <p className="mt-6 text-[14px] text-oat/45">— a casa da turma</p>
        </div>
        <ul className="relative grid grid-cols-3 gap-6 text-[13px] text-oat/55">
          <li>
            <span className="block font-display text-[30px] text-oat">4K</span>tela compartilhada
          </li>
          <li>
            <span className="block font-display text-[30px] text-oat">0 s</span>YouTube em sincronia
          </li>
          <li>
            <span className="block font-display text-[30px] text-oat">60</span>sons por servidor
          </li>
        </ul>
      </section>

      {/* formulário */}
      <section className="flex flex-col justify-center px-5 py-10 sm:px-12">
        <Link href="/" className="mb-10 font-display text-[24px] leading-none lg:hidden">
          Call dos Games
        </Link>
        <div className="mx-auto w-full max-w-[400px]">
          <p className="label text-ember">{kicker}</p>
          <h1 className="mt-3 font-display text-[44px] leading-[1.02] tracking-[-0.01em]">{title}</h1>
          <div className="mt-8">{API_READY ? children : <PendingNote />}</div>
        </div>
      </section>
    </main>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="mt-4 block first:mt-0">
      <span className="mb-1.5 block text-[13px] font-semibold text-oat/70">{label}</span>
      {children}
    </label>
  );
}

function Submit({ busy, children }: { busy: boolean; children: React.ReactNode }) {
  return (
    <button type="submit" disabled={busy} className="btn-ember mt-6 h-12 w-full text-[15px]">
      {busy ? "Só um instante…" : children}
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* Google                                                              */
/* ------------------------------------------------------------------ */

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize(o: { client_id: string; callback: (r: { credential: string }) => void; ux_mode?: string }): void;
          renderButton(el: HTMLElement, o: Record<string, unknown>): void;
        };
      };
    };
  }
}

function GoogleButton({ onSession, onError }: { onSession: (s: Session) => void; onError: (m: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [clientId, setClientId] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    api<{ google_client_id: string | null }>("/auth/config")
      // no app de celular o Google não deixa entrar por dentro do app; lá fica só o e-mail
      .then((c) => setClientId("cdgAndroid" in window ? null : c.google_client_id))
      .catch(() => setClientId(null));
  }, []);

  useEffect(() => {
    if (!clientId || !ref.current) return;
    const el = ref.current;
    const render = () => {
      window.google!.accounts.id.initialize({
        client_id: clientId,
        callback: async ({ credential }) => {
          try {
            onSession(await api<Session>("/auth/google", { json: { credential } }));
          } catch (e) {
            onError(errorText(e));
          }
        },
      });
      window.google!.accounts.id.renderButton(el, { theme: "filled_black", size: "large", shape: "pill", text: "continue_with", locale: "pt-BR", width: 400 });
    };
    if (window.google) return render();
    const s = document.createElement("script");
    s.src = "https://accounts.google.com/gsi/client";
    s.async = true;
    s.onload = render;
    document.head.appendChild(s);
  }, [clientId, onSession, onError]);

  if (!clientId) return null;
  return (
    <>
      <div ref={ref} className="flex min-h-11 justify-center [color-scheme:light]" />
      <div className="my-6 flex items-center gap-3 text-[12px] text-oat/35">
        <span className="h-px flex-1 bg-oat/10" />
        ou com e-mail
        <span className="h-px flex-1 bg-oat/10" />
      </div>
    </>
  );
}

function useFinish() {
  const router = useRouter();
  const next = useNext();
  return (s: Session) => {
    setToken(s.token);
    router.replace(s.new_account ? `${next}${next.includes("?") ? "&" : "?"}bem-vindo=1` : next);
  };
}

/* ------------------------------------------------------------------ */
/* entrar                                                              */
/* ------------------------------------------------------------------ */

export function LoginForm() {
  const finish = useFinish();
  const next = useNext();
  const router = useRouter();
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (getToken()) router.replace(next);
  }, [router, next]);

  return (
    <AuthFrame kicker="Que bom te ver" title={<>Bem-vindo de <span className="italic text-ember-2">volta</span>.</>}>
      <GoogleButton onSession={finish} onError={setError} />
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          try {
            finish(await api<Session>("/auth/login", { json: { login, password } }));
          } catch (err) {
            setError(errorText(err));
            setBusy(false);
          }
        }}
      >
        <Field label="E-mail ou usuário">
          <input className="field" value={login} onChange={(e) => setLogin(e.target.value)} autoComplete="username" required autoFocus />
        </Field>
        <Field label="Senha">
          <input className="field" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
        </Field>
        <Link href="/esqueci-senha" className="link-u mt-2 inline-block text-[13px] text-oat/55 hover:text-oat">
          Esqueci a senha
        </Link>
        <FormError>{error}</FormError>
        <Submit busy={busy}>Entrar</Submit>
      </form>
      <p className="mt-6 text-center text-[14px] text-oat/55">
        Primeira vez por aqui?{" "}
        <Link href={`/criar-conta${next !== "/app" ? `?next=${encodeURIComponent(next)}` : ""}`} className="font-semibold text-ember-2 hover:underline">
          Criar conta
        </Link>
      </p>
    </AuthFrame>
  );
}

/* ------------------------------------------------------------------ */
/* criar conta                                                         */
/* ------------------------------------------------------------------ */

export function RegisterForm() {
  const finish = useFinish();
  const next = useNext();
  const [f, setF] = useState({ display_name: "", username: "", email: "", password: "" });
  const [touchedUser, setTouchedUser] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const up = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF((v) => ({ ...v, [k]: e.target.value }));

  // sugere o @ a partir do nome, até a pessoa mexer nele
  const suggest = (name: string) =>
    name
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9_.]+/g, "")
      .slice(0, 24);

  return (
    <AuthFrame kicker="Primeira vez?" title={<>Arruma um <span className="italic text-ember-2">cantinho</span> pra você.</>}>
      <GoogleButton onSession={finish} onError={setError} />
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          try {
            const s = await api<Session>("/auth/register", { json: f });
            finish({ ...s, new_account: true });
          } catch (err) {
            setError(errorText(err));
            setBusy(false);
          }
        }}
      >
        <Field label="Como te chamam">
          <input
            className="field"
            value={f.display_name}
            onChange={(e) => {
              up("display_name")(e);
              if (!touchedUser) setF((v) => ({ ...v, username: suggest(e.target.value) }));
            }}
            maxLength={32}
            required
            autoFocus
          />
        </Field>
        <Field label="Usuário (o @ que a turma usa para te achar)">
          <div className="relative">
            <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-oat/35">@</span>
            <input
              className="field pl-7"
              value={f.username}
              onChange={(e) => {
                setTouchedUser(true);
                setF((v) => ({ ...v, username: e.target.value.toLowerCase().replace(/[^a-z0-9_.]/g, "") }));
              }}
              minLength={2}
              maxLength={32}
              required
              autoComplete="username"
            />
          </div>
        </Field>
        <Field label="E-mail">
          <input className="field" type="email" value={f.email} onChange={up("email")} required autoComplete="email" />
        </Field>
        <Field label="Senha (8 caracteres ou mais)">
          <input className="field" type="password" value={f.password} onChange={up("password")} minLength={8} required autoComplete="new-password" />
        </Field>
        <FormError>{error}</FormError>
        <Submit busy={busy}>Criar minha conta</Submit>
      </form>
      <p className="mt-6 text-center text-[14px] text-oat/55">
        Já tem conta?{" "}
        <Link href={`/entrar${next !== "/app" ? `?next=${encodeURIComponent(next)}` : ""}`} className="font-semibold text-ember-2 hover:underline">
          Entrar
        </Link>
      </p>
    </AuthFrame>
  );
}

/* ------------------------------------------------------------------ */
/* senha                                                               */
/* ------------------------------------------------------------------ */

export function ForgotForm() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <AuthFrame kicker="Acontece" title="Esqueceu a senha?">
      {sent ? (
        <div className="rounded-[14px] bg-cocoa-3 p-5 text-[14px] leading-relaxed text-oat/80">
          Se existir uma conta com <strong className="text-oat">{email}</strong>, o link para criar uma senha nova chega em alguns
          minutos. Olhe também o spam.
        </div>
      ) : (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError("");
            try {
              await api("/auth/forgot", { json: { email } });
              setSent(true);
            } catch (err) {
              setError(errorText(err));
            }
            setBusy(false);
          }}
        >
          <Field label="E-mail da conta">
            <input className="field" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
          </Field>
          <FormError>{error}</FormError>
          <Submit busy={busy}>Mandar o link</Submit>
        </form>
      )}
      <Link href="/entrar" className="link-u mt-6 inline-block text-[14px] text-oat/55 hover:text-oat">
        ← Voltar para o login
      </Link>
    </AuthFrame>
  );
}

export function ResetForm() {
  const finish = useFinish();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [token, setResetToken] = useState<string | null>(null);
  useEffect(() => {
    const params = new URLSearchParams(window.location.hash.slice(1));
    const value = params.get("token") ?? "";
    queueMicrotask(() => setResetToken(value));
    if (window.location.hash) window.history.replaceState(null, "", window.location.pathname + window.location.search);
  }, []);
  return (
    <AuthFrame kicker="Quase lá" title="Escolha uma senha nova">
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          try {
            finish(await api<Session>("/auth/reset", { json: { token: token ?? "", password } }));
          } catch (err) {
            setError(errorText(err));
            setBusy(false);
          }
        }}
      >
        <Field label="Senha nova (8 caracteres ou mais)">
          <input className="field" type="password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={8} required autoFocus autoComplete="new-password" />
        </Field>
        <FormError>{error || (token === "" ? "Link incompleto. Abra o link do e-mail de novo." : "")}</FormError>
        <Submit busy={busy || token === null}>Salvar e entrar</Submit>
      </form>
    </AuthFrame>
  );
}
