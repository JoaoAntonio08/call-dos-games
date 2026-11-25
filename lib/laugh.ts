"use client";

import { useEffect, useRef } from "react";

/* ------------------------------------------------------------------ */
/* Detector de risada: roda no navegador de cada um, só no PRÓPRIO     */
/* microfone. Nenhum áudio sai do PC: quando o modelo (YAMNet, do      */
/* MediaPipe, servido pelo próprio site) ouve risada, o app só avisa o */
/* servidor "ri". Duas pessoas rindo juntas viram um clipe.            */
/* ------------------------------------------------------------------ */

const LAUGH = /laugh|giggle|snicker|chuckle|chortle/i;
const THRESHOLD = 0.3;
const WINDOW_S = 1; // o modelo olha 1 s de áudio por vez
const STEP_S = 0.5; // e anda meio segundo
const QUIET_RMS = 0.012; // silêncio: nem roda o modelo
const REPORT_GAP_MS = 3000;

type Results = { classifications: { categories: { categoryName: string; score: number }[] }[] }[];
type Classifier = { classify(data: Float32Array, rate?: number): Results; close(): void };

let shared: Promise<Classifier> | null = null;

function loadClassifier(): Promise<Classifier> {
  shared ??= (async () => {
    const { AudioClassifier, FilesetResolver } = await import("@mediapipe/tasks-audio");
    const fileset = await FilesetResolver.forAudioTasks("/mediapipe");
    return (await AudioClassifier.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: "/models/yamnet.tflite" },
      maxResults: 8,
      scoreThreshold: 0.05,
    })) as unknown as Classifier;
  })().catch((e) => {
    shared = null;
    throw e;
  });
  return shared;
}

/** Quanto de risada tem nesse trecho (0..1). */
export function laughScore(results: Results): number {
  let best = 0;
  for (const r of results) for (const c of r.classifications) for (const cat of c.categories) if (LAUGH.test(cat.categoryName)) best = Math.max(best, cat.score);
  return best;
}

/**
 * Liga o detector no seu microfone enquanto `enabled`. `onLaugh` é chamado no máximo a cada 3 s,
 * e só quando dois trechos seguidos (de três) soam como risada: tosse ou grito isolado não dispara.
 */
export function useLaughDetector({ enabled, track, onLaugh }: { enabled: boolean; track?: MediaStreamTrack; onLaugh: () => void }) {
  const cb = useRef(onLaugh);
  useEffect(() => {
    cb.current = onLaugh;
  }, [onLaugh]);

  useEffect(() => {
    if (!enabled || !track || track.readyState !== "live" || typeof AudioContext === "undefined") return;
    let stopped = false;
    let ctx: AudioContext | null = null;
    let proc: ScriptProcessorNode | null = null;
    let src: MediaStreamAudioSourceNode | null = null;
    let sink: GainNode | null = null;
    let copy: MediaStreamTrack | null = null;

    void loadClassifier()
      .then((clf) => {
        if (stopped) return;
        ctx = new AudioContext();
        const rate = ctx.sampleRate;
        const size = Math.round(rate * WINDOW_S);
        const step = Math.round(rate * STEP_S);
        const ring = new Float32Array(size);
        let filled = 0;
        let sinceLast = 0;
        const hits: boolean[] = [];
        let lastReport = 0;

        // só a sua faixa de microfone: um clone, para não mexer no que vai para a call
        copy = track.clone();
        src = ctx.createMediaStreamSource(new MediaStream([copy]));
        proc = ctx.createScriptProcessor(4096, 1, 1);
        sink = ctx.createGain();
        sink.gain.value = 0; // não toca nada de volta
        proc.onaudioprocess = (e) => {
          const input = e.inputBuffer.getChannelData(0);
          // janela deslizante de 1 s
          if (input.length >= size) ring.set(input.subarray(input.length - size));
          else {
            ring.copyWithin(0, input.length);
            ring.set(input, size - input.length);
          }
          filled = Math.min(size, filled + input.length);
          sinceLast += input.length;
          if (filled < size || sinceLast < step) return;
          sinceLast = 0;
          let sum = 0;
          for (let i = 0; i < size; i += 4) sum += ring[i] * ring[i];
          const rms = Math.sqrt(sum / (size / 4));
          let hit = false;
          if (rms >= QUIET_RMS) {
            try {
              hit = laughScore(clf.classify(ring, rate)) >= THRESHOLD;
            } catch {
              hit = false;
            }
          }
          hits.push(hit);
          if (hits.length > 3) hits.shift();
          const now = Date.now();
          if (hits.filter(Boolean).length >= 2 && now - lastReport > REPORT_GAP_MS) {
            lastReport = now;
            hits.length = 0;
            cb.current();
          }
        };
        src.connect(proc);
        proc.connect(sink);
        sink.connect(ctx.destination);
      })
      .catch(() => {
        /* sem o modelo (navegador antigo, arquivo faltando): fica sem clipe de risada, o resto segue */
      });

    return () => {
      stopped = true;
      try {
        if (proc) proc.onaudioprocess = null;
        copy?.stop();
        src?.disconnect();
        proc?.disconnect();
        sink?.disconnect();
        void ctx?.close();
      } catch {
        /* já fechado */
      }
    };
  }, [enabled, track]);
}
