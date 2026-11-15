"use client";

import { Fragment, useState } from "react";
import Link from "next/link";
import type { CustomEmoji } from "@/lib/types";

/*
  Formatação leve das mensagens, sem HTML cru (nada de dangerouslySetInnerHTML):
  **negrito**  *itálico*  __sublinhado__  ~~riscado~~  `código`  ```bloco```  ||spoiler||
  > citação   links   @menção   :emoji_do_servidor:
*/

type Ctx = { emojis: CustomEmoji[]; meUsername?: string; onMention?: (username: string, el: HTMLElement) => void };

const URL_RE = /https?:\/\/[^\s<]+[^\s<.,:;"')\]!?]/;

const LINK_CLASS = "text-ember-2 underline decoration-ember/40 underline-offset-2 hover:decoration-ember";

/** Link do próprio app (canal, conversa, convite) navega aqui dentro: não recarrega a página nem derruba a call. */
function internalPath(url: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    const u = new URL(url);
    if (u.origin !== window.location.origin) return null;
    return /^\/app(\/|$)/.test(u.pathname) ? u.pathname + u.search + u.hash : null;
  } catch {
    return null;
  }
}

function ChatLink({ url }: { url: string }) {
  const path = internalPath(url);
  if (path) {
    return (
      <Link href={path} className={LINK_CLASS}>
        {url}
      </Link>
    );
  }
  return (
    <a href={url} target="_blank" rel="noopener noreferrer nofollow" className={LINK_CLASS}>
      {url}
    </a>
  );
}

function Spoiler({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <span role="button" tabIndex={0} onClick={() => setOpen(true)} onKeyDown={(e) => e.key === "Enter" && setOpen(true)} className={`spoiler px-0.5 ${open ? "open" : ""}`}>
      {children}
    </span>
  );
}

// ordem importa: primeiro o que não deve ser formatado por dentro
const INLINE: { re: RegExp; render: (m: RegExpExecArray, ctx: Ctx, key: string) => React.ReactNode }[] = [
  { re: /`([^`\n]+)`/, render: (m, _c, k) => <code key={k} className="rounded-[5px] bg-cocoa-0 px-1.5 py-0.5 text-[0.88em] text-oat-2">{m[1]}</code> },
  {
    re: URL_RE,
    render: (m, _c, k) => <ChatLink key={k} url={m[0]} />,
  },
  { re: /\|\|(.+?)\|\|/, render: (m, c, k) => <Spoiler key={k}>{inline(m[1], c, k)}</Spoiler> },
  { re: /\*\*(.+?)\*\*/, render: (m, c, k) => <strong key={k} className="font-semibold text-oat">{inline(m[1], c, k)}</strong> },
  { re: /__(.+?)__/, render: (m, c, k) => <u key={k}>{inline(m[1], c, k)}</u> },
  { re: /~~(.+?)~~/, render: (m, c, k) => <s key={k} className="opacity-70">{inline(m[1], c, k)}</s> },
  { re: /(?<![\w*])\*(?!\s)(.+?)(?<!\s)\*(?!\w)/, render: (m, c, k) => <em key={k}>{inline(m[1], c, k)}</em> },
  {
    re: /(?<![\w@])@([a-z0-9_.]{2,32})/i,
    render: (m, c, k) => {
      const mine = c.meUsername && m[1].toLowerCase() === c.meUsername.toLowerCase();
      return (
        <button
          key={k}
          type="button"
          onClick={(e) => c.onMention?.(m[1], e.currentTarget)}
          className={`rounded-[5px] px-1 font-semibold ${mine ? "bg-ember/25 text-ember-2" : "bg-oat/[0.08] text-oat hover:bg-oat/15"}`}
        >
          @{m[1]}
        </button>
      );
    },
  },
  {
    re: /:([a-z0-9_]{2,32}):/,
    render: (m, c, k) => {
      const e = c.emojis.find((x) => x.name === m[1].toLowerCase());
      if (!e) return m[0];
      return <img key={k} src={e.url} alt={`:${e.name}:`} title={`:${e.name}:`} className="mx-px inline-block size-[1.4em] -translate-y-[0.1em] object-contain align-middle" />;
    },
  },
];

function inline(text: string, ctx: Ctx, keyBase = "i"): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  let rest = text;
  let n = 0;
  while (rest) {
    let best: { idx: number; m: RegExpExecArray; r: (typeof INLINE)[number] } | null = null;
    for (const r of INLINE) {
      const m = r.re.exec(rest);
      if (m && (best === null || m.index < best.idx)) best = { idx: m.index, m, r };
    }
    if (!best) {
      out.push(rest);
      break;
    }
    if (best.idx > 0) out.push(rest.slice(0, best.idx));
    out.push(best.r.render(best.m, ctx, `${keyBase}-${n++}`));
    rest = rest.slice(best.idx + best.m[0].length);
  }
  return out;
}

export function RichText({ text, emojis = [], meUsername, onMention }: { text: string } & Partial<Ctx>) {
  const ctx: Ctx = { emojis, meUsername, onMention };
  // blocos de código primeiro
  const parts = text.split(/```(?:\w+\n)?([\s\S]*?)```/g);
  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <pre key={i} className="my-1.5 max-w-full overflow-x-auto rounded-[10px] bg-cocoa-0 px-3 py-2.5 text-[13px] leading-relaxed text-oat-2">
            {part.replace(/^\n|\n$/g, "")}
          </pre>
        ) : (
          <Fragment key={i}>
            {part.split("\n").map((line, j, arr) => {
              const quote = line.startsWith("> ");
              const content = inline(quote ? line.slice(2) : line, ctx, `${i}-${j}`);
              return (
                <Fragment key={j}>
                  {quote ? <span className="my-0.5 block border-l-[3px] border-oat/25 pl-3 text-oat/80">{content}</span> : content}
                  {j < arr.length - 1 && !quote && <br />}
                </Fragment>
              );
            })}
          </Fragment>
        ),
      )}
    </>
  );
}

/** Mensagem feita só de emojis (até 6) aparece grande. */
export function isJumbo(text: string): boolean {
  const t = text.trim();
  if (!t || t.length > 60) return false;
  const stripped = t.replace(/:[a-z0-9_]{2,32}:/g, "").replace(/\p{Extended_Pictographic}|\p{Emoji_Component}|️|‍|\s/gu, "");
  const count = (t.match(/:[a-z0-9_]{2,32}:|\p{Extended_Pictographic}/gu) ?? []).length;
  return stripped === "" && count > 0 && count <= 6;
}
