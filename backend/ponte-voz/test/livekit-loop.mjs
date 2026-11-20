// Teste com um LiveKit de verdade (local): a ponte com um "Discord de mentira".
// Uma pessoa daqui fala um tom de 440 Hz; alguém "do Discord" fala 660 Hz.
// Confere que o Discord recebe os 440 Hz e que a pessoa daqui escuta os 660 Hz pela ponte.
// Uso: rode "livekit-server --dev" e depois  node test/livekit-loop.mjs
import { AudioFrame, AudioSource, AudioStream, LocalAudioTrack, Room, RoomEvent, TrackKind, TrackPublishOptions, TrackSource, dispose } from "@livekit/rtc-node";
import { AccessToken } from "livekit-server-sdk";
import { CallBridge } from "../src/bridge.mjs";
import { every20ms } from "../src/clock.mjs";
import { LiveKitSide, bridgeToken } from "../src/livekit.mjs";
import { CHANNELS, FRAME, FRAME_LEN, RATE } from "../src/mixer.mjs";

const URL = process.env.LIVEKIT_URL || "ws://127.0.0.1:7880";
const KEY = "devkey";
const SECRET = "secret";
const ROOM = `cdg-teste-${Date.now()}`;

/** quanto de uma frequência tem no áudio (Goertzel), em relação à energia total */
function share(samples, freq) {
  const mono = new Float64Array(samples.length / 2);
  for (let i = 0; i < mono.length; i++) mono[i] = samples[2 * i];
  const k = (2 * Math.PI * freq) / RATE;
  let s1 = 0;
  let s2 = 0;
  let total = 0;
  for (const x of mono) {
    const s0 = x + 2 * Math.cos(k) * s1 - s2;
    s2 = s1;
    s1 = s0;
    total += x * x;
  }
  const power = s1 * s1 + s2 * s2 - 2 * Math.cos(k) * s1 * s2;
  return total ? (2 * power) / (mono.length * total) : 0;
}

function tone(freq) {
  let t = 0;
  return () => {
    const f = new Int16Array(FRAME_LEN);
    for (let i = 0; i < FRAME; i++, t++) f[2 * i] = f[2 * i + 1] = Math.round(8000 * Math.sin((2 * Math.PI * freq * t) / RATE));
    return f;
  };
}

class FakeDiscord {
  constructor({ onPcm, onEnd }) {
    this.onPcm = onPcm;
    this.onEnd = onEnd;
    this.got = [];
  }
  async start() {
    const next = tone(660);
    this.stop20 = every20ms(() => this.onPcm("dc:zeca", next()));
  }
  send(pcm) {
    this.got.push(pcm);
  }
  async stop() {
    this.stop20?.();
  }
}

async function person() {
  const t = new AccessToken(KEY, SECRET, { identity: "1001", name: "Ana" });
  t.addGrant({ room: ROOM, roomJoin: true, canPublish: true, canSubscribe: true });
  const room = new Room();
  const heard = [];
  room.on(RoomEvent.TrackSubscribed, async (track, _pub, p) => {
    if (track.kind !== TrackKind.KIND_AUDIO || p.identity !== "discord") return;
    for await (const f of new AudioStream(track, { sampleRate: RATE, numChannels: CHANNELS })) heard.push(f.data);
  });
  await room.connect(URL, await t.toJwt(), { autoSubscribe: true });
  const src = new AudioSource(RATE, CHANNELS, 1000);
  const opts = new TrackPublishOptions();
  opts.source = TrackSource.SOURCE_MICROPHONE;
  await room.localParticipant.publishTrack(LocalAudioTrack.createAudioTrack("mic", src), opts);
  const next = tone(440);
  const stop = every20ms(() => {
    src.captureFrame(new AudioFrame(next(), RATE, CHANNELS, FRAME)).catch(() => {});
  });
  return {
    heard,
    stop: async () => {
      stop();
      await room.disconnect();
    },
  };
}

function concat(list) {
  const out = new Int16Array(list.reduce((n, a) => n + a.length, 0));
  let o = 0;
  for (const a of list) {
    out.set(a, o);
    o += a.length;
  }
  return out;
}

let ok = true;
const check = (c, m) => {
  console.log(c ? "PASS" : "FAIL", m);
  if (!c) ok = false;
};

const ana = await person();
let fake;
const token = await bridgeToken({ key: KEY, secret: SECRET, room: ROOM });
const bridge = new CallBridge({
  makeDiscord: (cb) => (fake = new FakeDiscord(cb)),
  makeApp: (cb) => new LiveKitSide({ url: URL, token, ...cb }),
});
await bridge.start();
await new Promise((r) => setTimeout(r, 4000));
const toDiscord = concat(fake.got.slice(-100));
const toAna = concat(ana.heard.slice(-200));
const d440 = share(toDiscord, 440);
const d660 = share(toDiscord, 660);
const a660 = share(toAna, 660);
const a440 = share(toAna, 440);
check(fake.got.length >= 50, `o Discord recebeu áudio daqui (${(fake.got.length * 20) / 1000}s)`);
check(d440 > 0.5 && d660 < 0.05, `no Discord chegou a voz daqui, sem eco do próprio Discord (440 Hz: ${d440.toFixed(2)}, 660 Hz: ${d660.toFixed(2)})`);
check(toAna.length > RATE, `a pessoa daqui recebeu áudio da ponte (${(toAna.length / CHANNELS / RATE).toFixed(1)}s)`);
check(a660 > 0.5 && a440 < 0.05, `aqui chegou a voz do Discord, sem eco da própria voz (660 Hz: ${a660.toFixed(2)}, 440 Hz: ${a440.toFixed(2)})`);
await bridge.stop();
await ana.stop();
await dispose();
console.log(ok ? "TUDO OK" : "FALHOU ALGO");
process.exit(ok ? 0 : 1);
