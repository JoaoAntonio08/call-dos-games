// Lado do Call dos Games: entra na sala do LiveKit como "Discord", publica o áudio que vem de lá
// e escuta o microfone de quem está aqui.
import { AudioFrame, AudioSource, AudioStream, LocalAudioTrack, Room, RoomEvent, TrackKind, TrackPublishOptions, TrackSource } from "@livekit/rtc-node";
import { AccessToken } from "livekit-server-sdk";
import { CHANNELS, FRAME, RATE, toStereo } from "./mixer.mjs";

export const BRIDGE_IDENTITY = "discord";

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

  /** Um quadro de 20 ms (estéreo) que veio do Discord. */
  send(pcm) {
    if (this.closed || !this.source) return;
    this.source.captureFrame(new AudioFrame(pcm, RATE, CHANNELS, FRAME)).catch(() => {});
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
