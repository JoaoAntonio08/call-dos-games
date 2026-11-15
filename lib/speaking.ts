/* ------------------------------------------------------------------ */
/* Quem está falando, medido aqui mesmo no aparelho.                   */
/*                                                                      */
/* O aviso de "está falando" do servidor de voz chega atrasado (ele      */
/* junta o áudio de um tempo antes de avisar). Aqui o volume de cada     */
/* microfone é lido a cada 40 ms: o círculo verde acende junto com a     */
/* voz e apaga logo depois que a pessoa para.                            */
/* ------------------------------------------------------------------ */

const TICK_MS = 40;
/** volume (RMS) a partir do qual conta como fala; abaixo disso é ruído de fundo */
const THRESHOLD = 0.012;
/** segura aceso um pouquinho entre uma palavra e outra para não piscar */
const HOLD_MS = 280;

interface Probe {
  track: MediaStreamTrack;
  source: MediaStreamAudioSourceNode;
  analyser: AnalyserNode;
  buf: Float32Array<ArrayBuffer>;
  lastLoud: number;
  on: boolean;
}

export class SpeakingDetector {
  private ctx: AudioContext | null = null;
  private probes = new Map<string, Probe>();
  private timer = 0;

  constructor(private onChange: () => void) {}

  /** Liga/desliga a medição conforme os microfones que estão na call agora. */
  sync(tracks: Map<string, MediaStreamTrack | undefined>) {
    for (const [id, p] of this.probes) {
      const t = tracks.get(id);
      if (!t || t !== p.track || t.readyState === "ended") this.drop(id);
    }
    for (const [id, track] of tracks) {
      if (!track || track.readyState === "ended" || this.probes.has(id)) continue;
      try {
        this.ctx ??= new AudioContext();
        if (this.ctx.state === "suspended") void this.ctx.resume().catch(() => {});
        const source = this.ctx.createMediaStreamSource(new MediaStream([track]));
        const analyser = this.ctx.createAnalyser();
        analyser.fftSize = 512;
        source.connect(analyser); // não vai para os alto-falantes: só mede
        this.probes.set(id, { track, source, analyser, buf: new Float32Array(analyser.fftSize), lastLoud: 0, on: false });
      } catch {
        /* sem áudio de verdade nessa trilha */
      }
    }
    if (this.probes.size && !this.timer) this.timer = window.setInterval(() => this.tick(), TICK_MS);
    if (!this.probes.size && this.timer) {
      window.clearInterval(this.timer);
      this.timer = 0;
    }
  }

  /** undefined = não está medindo essa pessoa (aí vale o aviso do servidor) */
  speaking(id: string): boolean | undefined {
    return this.probes.get(id)?.on;
  }

  private tick() {
    const now = performance.now();
    let changed = false;
    for (const p of this.probes.values()) {
      p.analyser.getFloatTimeDomainData(p.buf);
      let sum = 0;
      for (let i = 0; i < p.buf.length; i++) sum += p.buf[i] * p.buf[i];
      const rms = Math.sqrt(sum / p.buf.length);
      if (rms > THRESHOLD && p.track.enabled && !p.track.muted) p.lastLoud = now;
      const on = now - p.lastLoud < HOLD_MS;
      if (on !== p.on) {
        p.on = on;
        changed = true;
      }
    }
    if (changed) this.onChange();
  }

  private drop(id: string) {
    const p = this.probes.get(id);
    if (!p) return;
    p.source.disconnect();
    this.probes.delete(id);
  }

  close() {
    window.clearInterval(this.timer);
    this.timer = 0;
    for (const id of [...this.probes.keys()]) this.drop(id);
    void this.ctx?.close().catch(() => {});
    this.ctx = null;
  }
}
