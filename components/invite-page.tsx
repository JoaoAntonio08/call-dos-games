"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { API_READY, api, errorText, getToken } from "@/lib/api";
import { ApiPending } from "@/components/api-pending";
import type { Media } from "@/lib/types";
import { AnimImg, FormError, ServerIcon } from "@/components/app/bits";

interface Preview {
  code: string;
  server: { id: string; name: string; description: string; icon: Media | null; banner: Media | null; members: number; online: number };
  inviter: string | null;
}

export function InvitePage() {
  const { code } = useParams<{ code: string }>();
  const router = useRouter();
  const [p, setP] = useState<Preview | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [logged, setLogged] = useState(false);

  useEffect(() => {
    if (!API_READY) return;
    setLogged(!!getToken());
    api<Preview>(`/invites/${code}`)
      .then((x) => {
        setP(x);
        document.title = `Convite para ${x.server.name} · Call dos Games`;
      })
      .catch((e) => setError(errorText(e)));
  }, [code]);

  async function join() {
    if (!logged) return router.push(`/criar-conta?next=${encodeURIComponent(`/convite/${code}`)}`);
    setBusy(true);
    try {
      const s = await api<{ id: string }>(`/invites/${code}/join`, { method: "POST" });
      router.push(`/app/s/${s.id}`);
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
    }
  }

  if (!API_READY) return <ApiPending />;

  return (
    <main className="grid min-h-svh flex-1 place-items-center bg-cocoa-1 p-4">
      <div className="w-full max-w-[440px] overflow-hidden rounded-[22px] bg-cocoa-2">
        <div className="relative h-[130px] bg-cocoa-4">{p?.server.banner && <AnimImg media={p.server.banner} alt="" className="size-full object-cover" play />}</div>
        <div className="px-6 pb-7">
          {p ? (
            <>
              <div className="-mt-10 inline-block rounded-[24px] bg-cocoa-2 p-1.5">
                <ServerIcon name={p.server.name} icon={p.server.icon} size={76} className="group" />
              </div>
              <p className="mt-3 text-[14px] text-oat/55">{p.inviter ? `${p.inviter} te chamou para` : "Você foi chamado para"}</p>
              <h1 className="font-display text-[38px] leading-[1.05]">{p.server.name}</h1>
              {p.server.description && <p className="mt-2 text-[14.5px] text-oat/65">{p.server.description}</p>}
              <p className="mt-3 flex items-center gap-4 text-[13.5px] text-oat/55">
                <span className="flex items-center gap-1.5">
                  <span className="size-2 rounded-full bg-moss" /> {p.server.online} online
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="size-2 rounded-full bg-cocoa-5" /> {p.server.members} {p.server.members === 1 ? "membro" : "membros"}
                </span>
              </p>
              <FormError>{error}</FormError>
              <button type="button" onClick={() => void join()} disabled={busy} className="btn-ember mt-6 h-12 w-full text-[15.5px]">
                {busy ? "Entrando…" : logged ? "Entrar no servidor" : "Criar conta e entrar"}
              </button>
              {!logged && (
                <p className="mt-3 text-center text-[13.5px] text-oat/50">
                  Já tem conta?{" "}
                  <Link href={`/entrar?next=${encodeURIComponent(`/convite/${code}`)}`} className="font-semibold text-ember-2 hover:underline">
                    Entrar
                  </Link>
                </p>
              )}
            </>
          ) : error ? (
            <div className="pt-8">
              <h1 className="font-display text-[32px] leading-tight">Convite sem validade</h1>
              <p className="mt-2 text-[14.5px] text-oat/60">{error}</p>
              <Link href="/" className="btn-quiet mt-6 inline-block px-5 py-3 text-[14px]">
                Ir para o início
              </Link>
            </div>
          ) : (
            <p className="pt-10 font-display-wonk text-[24px] text-oat/60">Abrindo o convite…</p>
          )}
        </div>
      </div>
    </main>
  );
}
