// Lado do Discord: o bot entra na call de lá, escuta cada pessoa (decodifica o Opus) e fala o que vem daqui.
// A criptografia de ponta a ponta das calls do Discord (DAVE) é feita pelo @discordjs/voice com o @snazzah/davey.
import { PassThrough } from "node:stream";
import { Client, Events, GatewayIntentBits } from "discord.js";
import {
  AudioPlayerStatus,
  EndBehaviorType,
  NoSubscriberBehavior,
  StreamType,
  VoiceConnectionStatus,
  createAudioPlayer,
  createAudioResource,
  entersState,
  joinVoiceChannel,
} from "@discordjs/voice";
import OpusScript from "opusscript";
import { CHANNELS, FRAME_LEN, RATE } from "./mixer.mjs";

const FRAME_BYTES = FRAME_LEN * 2;

/** Conecta o bot no Discord só com o necessário para voz (servidores e quem está nas calls). */
export async function discordClient(token) {
  const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates] });
  const ready = new Promise((resolve) => client.once(Events.ClientReady, resolve));
  await client.login(token);
  await ready;
  return client;
}

export class DiscordSide {
  /**
   * @param {object} o
   * @param {import("discord.js").Client} o.client
   * @param {string} o.guildId
   * @param {string} o.channelId
   * @param {(key: string, pcm: Int16Array) => void} o.onPcm  áudio de alguém do Discord
   * @param {(key: string) => void} o.onEnd                   essa pessoa parou de falar
   * @param {() => void} [o.onClose]                           o bot saiu/foi tirado da call
   */
  constructor({ client, guildId, channelId, onPcm, onEnd, onClose }) {
    Object.assign(this, { client, guildId, channelId, onPcm, onEnd, onClose });
    this.subs = new Map();
    this.closed = false;
  }

  async start() {
    const guild = await this.client.guilds.fetch(this.guildId);
    const conn = joinVoiceChannel({
      channelId: this.channelId,
      guildId: this.guildId,
      adapterCreator: guild.voiceAdapterCreator,
      selfDeaf: false,
      selfMute: false,
    });
    this.conn = conn;
    try {
      await entersState(conn, VoiceConnectionStatus.Ready, 20_000);
    } catch (e) {
      conn.destroy();
      throw new Error(`não consegui entrar na call do Discord (${e.message})`);
    }
    conn.on(VoiceConnectionStatus.Disconnected, async () => {
      // pode ser só troca de servidor de voz: espera reconectar; senão desiste
      try {
        await Promise.race([
          entersState(conn, VoiceConnectionStatus.Signalling, 5_000),
          entersState(conn, VoiceConnectionStatus.Connecting, 5_000),
        ]);
      } catch {
        if (!this.closed) {
          this.closed = true;
          conn.destroy();
          this.onClose?.();
        }
      }
    });
    conn.on(VoiceConnectionStatus.Destroyed, () => {
      if (!this.closed) {
        this.closed = true;
        this.onClose?.();
      }
    });
    conn.receiver.speaking.on("start", (userId) => this.listen(userId));

    // o que vem daqui: PCM cru → o @discordjs/voice codifica em Opus e manda
    this.out = new PassThrough({ highWaterMark: FRAME_BYTES * 6 });
    this.player = createAudioPlayer({ behaviors: { noSubscriber: NoSubscriberBehavior.Play, maxMissedFrames: Infinity } });
    this.player.on("error", () => {});
    this.player.on(AudioPlayerStatus.Idle, () => {
      if (!this.closed) this.player.play(createAudioResource(this.out, { inputType: StreamType.Raw }));
    });
    this.player.play(createAudioResource(this.out, { inputType: StreamType.Raw }));
    conn.subscribe(this.player);
  }

  listen(userId) {
    if (this.closed || this.subs.has(userId) || userId === this.client.user?.id) return;
    const key = `dc:${userId}`;
    const decoder = new OpusScript(RATE, CHANNELS, OpusScript.Application.VOIP);
    const stream = this.conn.receiver.subscribe(userId, { end: { behavior: EndBehaviorType.AfterSilence, duration: 600 } });
    this.subs.set(userId, stream);
    stream.on("data", (packet) => {
      try {
        const raw = decoder.decode(packet);
        // copia para um Int16Array alinhado (o Buffer pode começar num byte ímpar)
        const pcm = new Int16Array(raw.length / 2);
        new Uint8Array(pcm.buffer).set(raw);
        this.onPcm(key, pcm);
      } catch {
        /* pacote corrompido: pula */
      }
    });
    const done = () => {
      if (!this.subs.has(userId)) return;
      this.subs.delete(userId);
      try {
        decoder.delete();
      } catch {
        /* já liberado */
      }
      this.onEnd(key);
    };
    stream.once("end", done);
    stream.once("close", done);
    stream.once("error", done);
  }

  /** Um quadro de 20 ms (estéreo) que veio daqui. Se o Discord estiver atrasado, descarta em vez de acumular atraso. */
  send(pcm) {
    if (this.closed || !this.out) return;
    if (this.out.writableLength > FRAME_BYTES * 5) return;
    this.out.write(Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength));
  }

  async stop() {
    this.closed = true;
    for (const s of this.subs.values()) s.destroy();
    this.subs.clear();
    this.player?.stop(true);
    this.out?.end();
    try {
      this.conn?.destroy();
    } catch {
      /* já saiu */
    }
  }
}
