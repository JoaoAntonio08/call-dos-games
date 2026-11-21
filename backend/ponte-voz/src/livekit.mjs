// Lado do Call dos Games: entra na sala do LiveKit como "Discord", publica o áudio que vem de lá
// e escuta o microfone de quem está aqui.
import { AudioFrame, AudioSource, AudioStream, LocalAudioTrack, Room, RoomEvent, TrackKind, TrackPublishOptions, TrackSource } from "@livekit/rtc-node";
import { AccessToken } from "livekit-server-sdk";
import { CHANNELS, FRAME, RATE, toStereo } from "./mixer.mjs";

export const BRIDGE_IDENTITY = "discord";
/** Quadros esperando o LiveKit aceitar. Passou disso, descarta (melhor perder 20 ms que acumular atraso). */
export const MAX_PENDING = 3;

export async function bridgeToken({ key, secret, room }) {
  const t = new AccessToken(key, secret, {
    identity: BRIDGE_IDENTITY,
    name: "Discord",
    ttl: "12h",
    // o app lê a cor e a foto daqui (sem foto: usa a inicial na cor do Discord)
    metadata: JSON.stringify({ accent: "#5865f2", avatar: null, username: "discord" }),
  });
  t.addGrant({ room, roomJoin: true, canPublish: true, canSubscribe: true, canPublishData: false });
  return t.toJwt();
}

export class LiveKitSide {
  /**
   * @param {object} o
   * @param {string} o.url
   * @param {string} o.token
   * @param {(key: string, pcm: Int16Array) => void} o.onPcm  áudio de alguém daqui
   * @param {(key: string) => void} o.onEnd                   essa pessoa parou (saiu, desligou o microfone)
   * @param {() => void} [o.onClose]                           caiu a conexão com o LiveKit
   */
  constructor({ url, token, onPcm, onEnd, onClose }) {
    Object.assign(this, { url, token, onPcm, onEnd, onClose });
    this.closed = false;
    this.readers = new Map();
    this.pending = 0;
    this.dropped = 0;
  }

  async start() {
    const room = new Room();
    this.room = room;
    room.on(RoomEvent.TrackSubscribed, (track, pub, participant) => {
      // só a voz das pessoas (nem tela, nem outras pontes)
      if (track.kind !== TrackKind.KIND_AUDIO || pub.source !== TrackSource.SOURCE_MICROPHONE) return;
      if (participant.identity === BRIDGE_IDENTITY) return;
      void this.read(track, `${participant.identity}:${pub.sid}`);
    });
    room.on(RoomEvent.Disconnected, () => {
      if (!this.closed) this.onClose?.();
    });
    await room.connect(this.url, this.token, { autoSubscribe: true, dynacast: false });
    if (this.closed) {
      await room.disconnect().catch(() => {});
      throw new Error("saiu enquanto entrava no LiveKit");
    }
    this.source = new AudioSource(RATE, CHANNELS, 1000);
    const track = LocalAudioTrack.createAudioTrack("discord", this.source);
    const opts = new TrackPublishOptions();
    opts.source = TrackSource.SOURCE_MICROPHONE;
    await room.localParticipant.publishTrack(track, opts);
  }

  async read(track, key) {
    if (this.readers.has(key)) return;
    const stream = new AudioStream(track, { sampleRate: RATE, numChannels: CHANNELS });
    this.readers.set(key, stream);
    try {
      for await (const f of stream) {
        if (this.closed) break;
        this.onPcm(key, toStereo(f.data, f.channels));
      }
    } catch {
      /* a faixa acabou */
    } finally {
      this.readers.delete(key);
      this.onEnd(key);
    }
  }

  /**
   * Um quadro de 20 ms (estéreo) que veio do Discord. O captureFrame só resolve quando o LiveKit aceita o quadro;
   * se ele estiver atrasado, não empilha promessas sem fim: descarta o quadro e o atraso não cresce.
   * @returns {boolean} se o quadro foi entregue
   */
  send(pcm) {
    if (this.closed || !this.source) return false;
    if (this.pending >= MAX_PENDING) {
      this.dropped++;
      return false;
    }
    this.pending++;
    const done = () => {
      this.pending--;
    };
    let p;
    try {
      p = this.source.captureFrame(new AudioFrame(pcm, RATE, CHANNELS, FRAME));
    } catch {
      done();
      return false;
    }
    Promise.resolve(p).then(done, done);
    return true;
  }

  async stop() {
    this.closed = true;
    for (const s of this.readers.values()) s.cancel().catch(() => {});
    try {
      await this.room?.disconnect();
    } catch {
      /* já saiu */
    }
    await this.source?.close?.();
  }
}
