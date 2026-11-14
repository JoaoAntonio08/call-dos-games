"use client";

import { useEffect, useState } from "react";
import { Room } from "livekit-client";
import { FREE_TIER_GB, RESOLUTIONS, bitrateFor, gbPerHour, type ResolutionId, type ShareSettings } from "@/lib/use-call";
import { parseYouTube } from "@/lib/use-youtube-sync";

/** Folha de papel presa no topo do dock. */
export function Panel({
  title,
  kicker,
  onClose,
  children,
}: {
  title: string;
  kicker: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div
      role="dialog"
      aria-label={title}
      className="pop-in max-h-[calc(100svh-160px)] w-[min(400px,calc(100vw-16px))] overflow-y-auto rounded-[18px] bg-cocoa-0 text-oat"
    >
      <div className="flex items-start justify-between border-b border-oat/10 px-5 pb-3 pt-4">
        <div>
          <p className="label text-ember">{kicker}</p>
          <h2 className="mt-2 font-display text-[30px] leading-none">{title}</h2>
        </div>
        <button type="button" onClick={onClose} aria-label="Fechar" className="label link-u mt-0.5">
          Fechar ×
        </button>
      </div>
      <div className="px-5 pb-5">{children}</div>
    </div>
  );
}

function Segmented<T extends string | number>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div role="group" aria-label={label} className="flex gap-1 rounded-[12px] bg-cocoa-3 p-1">
      {options.map((o, i) => (
        <button
          key={String(o.value)}
          type="button"
          aria-pressed={o.value === value}
          onClick={() => onChange(o.value)}
          className={`press h-8 flex-1 rounded-[9px] px-2 text-[12.5px] font-semibold ${
            o.value === value ? "bg-oat text-cocoa-0" : "text-oat/70 hover:bg-cocoa-5"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

const Field = ({ n, label, children, hint }: { n: string; label: string; children: React.ReactNode; hint?: React.ReactNode }) => (
  <div className="mt-5">
    <p className="label mb-2 opacity-60">
      {n} — {label}
    </p>
    {children}
    {hint && <p className="mt-2 text-[11px] leading-snug opacity-60">{hint}</p>}
  </div>
);

const Primary = (props: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
  <button
    {...props}
    className="btn-ember group mt-6 flex h-12 w-full items-center justify-between px-4"
  >
    <span className="text-[15px] leading-none">{props.children}</span>
    <span aria-hidden className="transition-transform duration-200 group-hover:translate-x-1">
      →
    </span>
  </button>
);

/* ---------------- compartilhar tela ---------------- */

export function SharePanel({
  initial,
  viewers,
  onStart,
  onClose,
  freeTier = true,
}: {
  initial: ShareSettings;
  /** false quando o servidor de voz é próprio (sem franquia de GB) */
  freeTier?: boolean;
  /** quantas pessoas vão receber a tela (todo mundo menos você) */
  viewers: number;
  onStart: (s: ShareSettings) => void;
  onClose: () => void;
}) {
  const [s, setS] = useState(initial);
  const up = (p: Partial<ShareSettings>) => setS((v) => ({ ...v, ...p }));
  const mbps = (bitrateFor(s.resolution, s.fps) / 1_000_000).toFixed(1).replace(".0", "").replace(".", ",");
  const watchers = Math.max(1, viewers);
  const gbHour = gbPerHour(s.resolution, s.fps) * watchers;
  const hoursLeft = FREE_TIER_GB / gbHour;
  const fmt = (n: number) => (n < 10 ? n.toFixed(1) : Math.round(n).toString()).replace(".", ",");
  const heavy = freeTier && hoursLeft < 6;

  return (
    <Panel title="Compartilhar tela" kicker="Transmissão" onClose={onClose}>
      <Field n="01" label="O que vai passar">
        <Segmented
          label="Tipo de conteúdo"
          value={s.mode}
          onChange={(mode) => up({ mode })}
          options={[
            { value: "video", label: "Anime / vídeo" },
            { value: "game", label: "Jogo" },
          ]}
        />
      </Field>
      <Field n="02" label="Resolução e fps">
        <Segmented
          label="Resolução"
          value={s.resolution}
          onChange={(resolution) => up({ resolution })}
          options={(Object.keys(RESOLUTIONS) as ResolutionId[]).map((r) => ({ value: r, label: RESOLUTIONS[r].label }))}
        />
        <div className="mt-2">
          <Segmented
            label="Quadros por segundo"
            value={s.fps}
            onChange={(fps) => up({ fps })}
            options={[
              { value: 30, label: "30 fps" },
              { value: 60, label: "60 fps" },
            ]}
          />
        </div>
      </Field>
      <Field
        n="03"
        label="Codec"
        hint={
          s.codec === "h264"
            ? "H.264 usa a placa de vídeo e pesa menos enquanto você joga."
            : s.codec === "av1"
              ? "AV1 tem a melhor imagem por megabit, mas exige placa recente."
              : "VP9 fica mais nítido que o H.264 no mesmo upload e usa mais processador."
        }
      >
        <Segmented
          label="Codec"
          value={s.codec}
          onChange={(codec) => up({ codec })}
          options={[
            { value: "h264", label: "H.264" },
            { value: "vp9", label: "VP9" },
            { value: "av1", label: "AV1" },
          ]}
        />
      </Field>
      <label className="mt-5 flex cursor-pointer items-center justify-between border-y border-oat/10 py-3 text-[13px] font-medium">
        Mandar o som junto
        <input type="checkbox" checked={s.audio} onChange={(e) => up({ audio: e.target.checked })} className="size-4 accent-[#5865f2]" />
      </label>

      {/* ficha de consumo: upload de quem transmite e gasto da franquia grátis */}
      <div className="mt-4 grid grid-cols-2 overflow-hidden rounded-[12px] bg-cocoa-3">
        <div className="px-3 py-2.5">
          <p className="label opacity-55">Seu upload</p>
          <p className="mt-1.5 font-display text-[26px] leading-none">{mbps} Mbps</p>
        </div>
        <div className={`border-l border-oat/10 px-3 py-2.5 ${heavy ? "bg-ember text-white" : ""}`}>
          <p className={`label ${heavy ? "" : "opacity-55"}`}>Consumo</p>
          <p className="mt-1.5 font-display text-[26px] leading-none">
            {fmt(gbHour)} GB<span className="text-[16px]">/hora</span>
          </p>
        </div>
        <p className="col-span-2 border-t border-oat/10 px-3 py-2.5 text-[12px] leading-relaxed">
          {freeTier ? (
            <>
              Com {watchers} {watchers === 1 ? "pessoa assistindo" : "pessoas assistindo"}, a franquia grátis do LiveKit ({FREE_TIER_GB} GB/mês) dura{" "}
              <strong className={heavy ? "text-ember-2" : ""}>~{fmt(hoursLeft)} horas</strong> nesse ritmo.
              {heavy && " Para anime, prefira o botão YouTube: quase não gasta."}
            </>
          ) : (
            <>
              Servidor de voz próprio: sem franquia mensal. O limite é o upload da sua internet e a banda do servidor ({fmt(gbHour)} GB/hora saindo
              dele com {watchers} {watchers === 1 ? "pessoa" : "pessoas"}).
            </>
          )}
        </p>
      </div>
      <p className="mt-2 text-[11px] leading-snug opacity-60">
        {s.resolution === "2160p" && "Se engasgar, desça para 1440p ou 1080p. "}
        {s.mode === "game" && "Jogo em tela cheia sem bordas evita tela preta. "}
        {s.audio && "Na janela do navegador, marque “Compartilhar áudio”."}
      </p>

      <Primary type="button" onClick={() => onStart(s)}>
        Escolher o que compartilhar
      </Primary>
    </Panel>
  );
}

/* ---------------- YouTube ---------------- */

export function YouTubePanel({ onLoad, onClose }: { onLoad: (url: string) => boolean; onClose: () => void }) {
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  return (
    <Panel title="Assistir no YouTube" kicker="Sessão sincronizada" onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!parseYouTube(url)) return setError("Esse link não parece ser do YouTube.");
          if (onLoad(url)) onClose();
        }}
      >
        <Field n="01" label="Link do vídeo">
          <input
            autoFocus
            value={url}
            onChange={(e) => {
              setUrl(e.target.value);
              setError("");
            }}
            placeholder="Cole o link do vídeo"
            className="field"
          />
        </Field>
        {error && <p className="mt-2 text-[12px] font-medium text-ember-2">× {error}</p>}
        <p className="mt-3 text-[12px] leading-relaxed opacity-60">
          Abre no player de cada um, na qualidade máxima do YouTube. Play, pause e pulos valem para todos.
        </p>
        <Primary type="submit">Colocar para todos</Primary>
      </form>
    </Panel>
  );
}

/* ---------------- dispositivos ---------------- */

type Kind = "audioinput" | "videoinput" | "audiooutput";
const KIND_LABEL: Record<Kind, string> = {
  audioinput: "Microfone",
  videoinput: "Câmera",
  audiooutput: "Saída de som",
};

export function DevicesPanel({ room, onClose }: { room: Room; onClose: () => void }) {
  const [devices, setDevices] = useState<Record<Kind, MediaDeviceInfo[]>>({ audioinput: [], videoinput: [], audiooutput: [] });
  const [active, setActive] = useState<Record<Kind, string>>({ audioinput: "", videoinput: "", audiooutput: "" });

  useEffect(() => {
    let alive = true;
    (async () => {
      const kinds: Kind[] = ["audioinput", "videoinput", "audiooutput"];
      const lists = await Promise.all(kinds.map((k) => Room.getLocalDevices(k, false).catch(() => [])));
      if (!alive) return;
      setDevices({ audioinput: lists[0], videoinput: lists[1], audiooutput: lists[2] });
      setActive({
        audioinput: room.getActiveDevice("audioinput") ?? "",
        videoinput: room.getActiveDevice("videoinput") ?? "",
        audiooutput: room.getActiveDevice("audiooutput") ?? "",
      });
    })();
    return () => {
      alive = false;
    };
  }, [room]);

  const kinds = (Object.keys(KIND_LABEL) as Kind[]).filter((k) => devices[k].length);
  return (
    <Panel title="Dispositivos" kicker="Ajustes" onClose={onClose}>
      {kinds.length === 0 && <p className="mt-5 text-[13px] opacity-60">Nenhum dispositivo liberado ainda.</p>}
      {kinds.map((k, i) => (
        <Field key={k} n={String(i + 1).padStart(2, "0")} label={KIND_LABEL[k]}>
          <select
            value={active[k]}
            onChange={async (e) => {
              const id = e.target.value;
              setActive((a) => ({ ...a, [k]: id }));
              await room.switchActiveDevice(k, id).catch(() => {});
            }}
            className="field h-10 !py-0 text-[13px]"
          >
            {devices[k].map((d, j) => (
              <option key={d.deviceId || j} value={d.deviceId}>
                {d.label || `${KIND_LABEL[k]} ${j + 1}`}
              </option>
            ))}
          </select>
        </Field>
      ))}
      <p className="mt-5 border-l-4 border-ember pl-3 text-[12px] leading-relaxed text-oat/75">
        Use fone de ouvido: assim o som do anime não volta pelo seu microfone.
      </p>
    </Panel>
  );
}
