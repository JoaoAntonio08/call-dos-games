// Mistura o áudio de várias pessoas num só (PCM 16 bits, 48 kHz, estéreo intercalado).
// Cada fonte tem a própria fila; a cada 20 ms sai um quadro com a soma de quem tinha áudio.

export const RATE = 48000;
export const CHANNELS = 2;
export const FRAME = 960; // amostras por canal em 20 ms
export const FRAME_LEN = FRAME * CHANNELS; // valores no Int16Array de um quadro

const PER_MS = (RATE / 1000) * CHANNELS;

export class Mixer {
  /**
   * @param {object} [o]
   * @param {number} [o.startMs] quanto juntar antes de começar a tocar uma fonte (segura os solavancos da rede)
   * @param {number} [o.maxMs] fila máxima por fonte; passou disso, joga fora o mais velho (atraso não cresce)
   */
  constructor({ startMs = 40, maxMs = 240 } = {}) {
    this.start = startMs * PER_MS;
    this.max = maxMs * PER_MS;
    /** @type {Map<string, {buf: Int16Array, playing: boolean}>} */
    this.sources = new Map();
  }

  /** Áudio novo de uma fonte (qualquer tamanho). */
  push(key, pcm) {
    if (!pcm || !pcm.length) return;
    let s = this.sources.get(key);
    if (!s) {
      s = { buf: new Int16Array(0), playing: false };
      this.sources.set(key, s);
    }
    const next = new Int16Array(s.buf.length + pcm.length);
    next.set(s.buf, 0);
    next.set(pcm, s.buf.length);
    // passou do limite: corta pelo começo, sempre num limite de amostra estéreo
    if (next.length > this.max) {
      let cut = next.length - this.max;
      cut += cut % CHANNELS;
      s.buf = next.subarray(cut);
    } else {
      s.buf = next;
    }
  }

  /** A fonte saiu (parou de falar, saiu da call). */
  remove(key) {
    this.sources.delete(key);
  }

  get size() {
    return this.sources.size;
  }

  /** Próximo quadro de 20 ms, ou null quando ninguém tem áudio (aí não manda nada). */
  pull() {
    let acc = null;
    for (const s of this.sources.values()) {
      if (!s.playing) {
        if (s.buf.length < this.start) continue;
        s.playing = true;
      }
      if (s.buf.length < FRAME_LEN) {
        s.playing = false; // acabou o que tinha: espera juntar de novo
        continue;
      }
      acc ??= new Int32Array(FRAME_LEN);
      for (let i = 0; i < FRAME_LEN; i++) acc[i] += s.buf[i];
      s.buf = s.buf.subarray(FRAME_LEN);
    }
    if (!acc) return null;
    const out = new Int16Array(FRAME_LEN);
    for (let i = 0; i < FRAME_LEN; i++) out[i] = acc[i] > 32767 ? 32767 : acc[i] < -32768 ? -32768 : acc[i];
    return out;
  }
}

/** Mono → estéreo intercalado (algumas fontes chegam em mono). */
export function toStereo(pcm, channels) {
  if (channels === 2) return pcm;
  const out = new Int16Array(pcm.length * 2);
  for (let i = 0; i < pcm.length; i++) out[2 * i] = out[2 * i + 1] = pcm[i];
  return out;
}
