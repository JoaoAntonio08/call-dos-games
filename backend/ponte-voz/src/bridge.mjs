// Junta os dois lados de uma call: o que vem do Discord vai para o LiveKit e vice-versa,
// misturado a cada 20 ms. Os lados só precisam ter start(), send(pcm) e stop().
import { every20ms } from "./clock.mjs";
import { Mixer } from "./mixer.mjs";

export class CallBridge {
  /**
   * @param {object} o
   * @param {(cb: object) => object} o.makeDiscord  recebe {onPcm, onEnd, onClose} e devolve o lado do Discord
   * @param {(cb: object) => object} o.makeApp      recebe {onPcm, onEnd, onClose} e devolve o lado do LiveKit
   * @param {() => void} [o.onClose]                um dos lados caiu (quem gerencia decide se tenta de novo)
   */
  constructor({ makeDiscord, makeApp, onClose }) {
    this.toApp = new Mixer();
    this.toDiscord = new Mixer();
    this.onClose = onClose;
    this.stopped = false;
    const closed = () => {
      if (!this.stopped) this.onClose?.();
    };
    this.discord = makeDiscord({ onPcm: (k, pcm) => this.toApp.push(k, pcm), onEnd: (k) => this.toApp.remove(k), onClose: closed });
    this.app = makeApp({ onPcm: (k, pcm) => this.toDiscord.push(k, pcm), onEnd: (k) => this.toDiscord.remove(k), onClose: closed });
  }

  async start() {
    try {
      await this.app.start();
      if (this.stopped) throw new Error("ponte parada enquanto entrava");
      await this.discord.start();
      if (this.stopped) throw new Error("ponte parada enquanto entrava");
    } catch (e) {
      // parou no meio (prazo estourou, ligação mudou): garante que nenhum lado fique conectado
      this.stopped = false;
      await this.stop();
      throw e;
    }
    this.stopClock = every20ms(() => {
      const a = this.toApp.pull();
      if (a) this.app.send(a);
      const d = this.toDiscord.pull();
      if (d) this.discord.send(d);
    });
  }

  async stop() {
    if (this.stopped) return;
    this.stopped = true;
    this.stopClock?.();
    await Promise.allSettled([this.discord.stop(), this.app.stop()]);
  }
}
