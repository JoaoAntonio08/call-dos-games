import Link from "next/link";

/** Site publicado antes de a API da turma estar no ar: avisa em vez de mostrar login quebrado. */
export function PendingNote() {
  return (
    <div className="border-l-2 border-ember pl-4">
      <p className="text-[15px] font-semibold text-oat">O servidor da turma ainda está sendo montado.</p>
      <p className="mt-1.5 text-[14px] leading-relaxed text-oat/55">
        Contas, servidores e chat chegam em breve. Enquanto isso, a call rápida por chave já funciona: escolha uma chave, mande para a turma e entrem.
      </p>
      <Link href="/#rapida" className="btn-ember mt-4 inline-flex h-10 items-center px-4 text-[14px]">
        Abrir uma call rápida
      </Link>
    </div>
  );
}

export function ApiPending() {
  return (
    <main className="grid min-h-svh flex-1 place-items-center bg-cocoa-1 p-6">
      <div className="w-full max-w-[440px]">
        <Link href="/" className="font-display text-[24px] leading-none">
          Call dos Games
        </Link>
        <div className="mt-8">
          <PendingNote />
        </div>
      </div>
    </main>
  );
}
