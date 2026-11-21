// Ponte de voz do Call dos Games: liga as calls daqui às calls do Discord.
// A cada 3 s pergunta à API quais calls estão ligadas e se tem gente nos dois lados.
// Tem gente dos dois lados → o bot entra na call do Discord e a ponte entra na sala do LiveKit.
// Um dos lados ficou vazio por 20 s → sai das duas.
//
// Lê a configuração do backend/.env (mesmo arquivo da API):
//   DISCORD_BOT_TOKEN, DISCORD_VOICE_SECRET, LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET
//   PONTE_API (opcional, padrão http://127.0.0.1:8000)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CallBridge } from "./bridge.mjs";
import { DiscordSide, discordClient } from "./discord.mjs";
import { LiveKitSide, bridgeToken } from "./livekit.mjs";
import { fetchState, plan, withTimeout } from "./plan.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const POLL_MS = 3000;
const GRACE_MS = 20_000;
const API_TIMEOUT_MS = 5000; // a API não respondeu nisso: tenta na próxima volta
const START_TIMEOUT_MS = 45_000; // entrar nos dois lados (o Discord sozinho já tem 20 s)

function loadEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m || m[1] in process.env) continue;
    process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, "$2");
  }
}
loadEnv(process.env.CDG_ENV_FILE || path.join(here, "..", "..", ".env"));

const log = (...a) => console.log(new Date().toISOString(), ...a);
const need = ["DISCORD_BOT_TOKEN", "DISCORD_VOICE_SECRET", "LIVEKIT_URL", "LIVEKIT_API_KEY", "LIVEKIT_API_SECRET"];
const missing = need.filter((k) => !process.env[k]);
if (missing.length) {
  log(`ponte de voz desligada: falta ${missing.join(", ")} no .env`);
  // sai "com sucesso" para o systemd não ficar reiniciando à toa
  process.exit(0);
}
const API = (process.env.PONTE_API || "http://127.0.0.1:8000").replace(/\/$/, "");

/** @type {Map<string, {bridge: CallBridge, idleSince: number | null, link: object}>} */
const bridges = new Map();
/** canal -> quando pode tentar de novo depois de uma falha */
const retryAt = new Map();

/** call daqui -> com qual call (do mesmo servidor do Discord) ela está esperando; para avisar uma vez só */
const waitingLogged = new Map();

async function open(client, link) {
  const token = await bridgeToken({ key: process.env.LIVEKIT_API_KEY, secret: process.env.LIVEKIT_API_SECRET, room: link.room });
  const entry = { link, idleSince: null, bridge: null };
  entry.bridge = new CallBridge({
    makeDiscord: (cb) => new DiscordSide({ client, guildId: link.guild_id, channelId: link.discord_channel_id, ...cb }),
    makeApp: (cb) => new LiveKitSide({ url: process.env.LIVEKIT_URL, token, ...cb }),
    onClose: () => {
      // só fecha a ponte desta entrada (a call pode já ter uma ponte nova para outro destino)
      if (bridges.get(link.channel_id) !== entry) return;
      log(`call ${link.channel_id}: um dos lados caiu; tento de novo na próxima volta`);
      void close(link.channel_id, "um dos lados caiu");
    },
  });
  bridges.set(link.channel_id, entry);
  try {
    await withTimeout(entry.bridge.start(), START_TIMEOUT_MS, "entrar na call");
    log(`call ${link.channel_id}: ponte ligada (${link.app_people} aqui, ${link.discord_people} no Discord)`);
  } catch (e) {
    bridges.delete(link.channel_id);
    await entry.bridge.stop();
    retryAt.set(link.channel_id, Date.now() + 30_000);
    log(`call ${link.channel_id}: não deu para ligar (${e.message}); tento de novo em 30 s`);
  }
}

async function close(channelId, why = "") {
  const entry = bridges.get(channelId);
  if (!entry) return;
  bridges.delete(channelId);
  await entry.bridge.stop();
  log(`call ${channelId}: ponte desligada${why ? ` (${why})` : ""}`);
}

async function loop(client) {
  for (;;) {
    try {
      const s = await fetchState(API, process.env.DISCORD_VOICE_SECRET, { timeoutMs: API_TIMEOUT_MS });
      const todo = plan(s.links || [], bridges, { now: Date.now(), retryAt, graceMs: GRACE_MS });
      // fecha antes de abrir: libera o bot no servidor do Discord e para o áudio no destino velho
      for (const { id, why } of todo.close) await close(id, why);
      for (const link of todo.open) {
        waitingLogged.delete(link.channel_id);
        await open(client, link);
      }
      for (const { link, holder } of todo.waiting) {
        if (waitingLogged.get(link.channel_id) === holder) continue;
        waitingLogged.set(link.channel_id, holder);
        log(`call ${link.channel_id}: esperando, o bot já está na call ${holder} do mesmo servidor do Discord`);
      }
    } catch (e) {
      log(`não consegui falar com a API (${e.message})`);
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}

const client = await discordClient(process.env.DISCORD_BOT_TOKEN);
log(`ponte de voz no ar como ${client.user.tag}`);
for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, async () => {
    await Promise.allSettled([...bridges.keys()].map(close));
    await client.destroy();
    process.exit(0);
  });
}
await loop(client);
