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

const here = path.dirname(fileURLToPath(import.meta.url));
const POLL_MS = 3000;
const GRACE_MS = 20_000;

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

async function state() {
  const r = await fetch(`${API}/internal/discord-voice`, { headers: { "x-bridge-secret": process.env.DISCORD_VOICE_SECRET } });
  if (!r.ok) throw new Error(`API respondeu ${r.status}`);
  return r.json();
}

async function open(client, link) {
  const token = await bridgeToken({ key: process.env.LIVEKIT_API_KEY, secret: process.env.LIVEKIT_API_SECRET, room: link.room });
  const entry = { link, idleSince: null, bridge: null };
  entry.bridge = new CallBridge({
    makeDiscord: (cb) => new DiscordSide({ client, guildId: link.guild_id, channelId: link.discord_channel_id, ...cb }),
    makeApp: (cb) => new LiveKitSide({ url: process.env.LIVEKIT_URL, token, ...cb }),
    onClose: () => {
      log(`call ${link.channel_id}: um dos lados caiu; tento de novo na próxima volta`);
      void close(link.channel_id);
    },
  });
  bridges.set(link.channel_id, entry);
  try {
    await entry.bridge.start();
    log(`call ${link.channel_id}: ponte ligada (${link.app_people} aqui, ${link.discord_people} no Discord)`);
  } catch (e) {
    bridges.delete(link.channel_id);
    retryAt.set(link.channel_id, Date.now() + 30_000);
    log(`call ${link.channel_id}: não deu para ligar (${e.message}); tento de novo em 30 s`);
  }
}

async function close(channelId) {
  const entry = bridges.get(channelId);
  if (!entry) return;
  bridges.delete(channelId);
  await entry.bridge.stop();
  log(`call ${channelId}: ponte desligada`);
}

async function loop(client) {
  for (;;) {
    try {
      const s = await state();
      const seen = new Set();
      for (const link of s.links || []) {
        seen.add(link.channel_id);
        const entry = bridges.get(link.channel_id);
        if (link.active) {
          if (entry) entry.idleSince = null;
          else if ((retryAt.get(link.channel_id) ?? 0) <= Date.now()) await open(client, link);
        } else if (entry) {
          entry.idleSince ??= Date.now();
          if (Date.now() - entry.idleSince > GRACE_MS) await close(link.channel_id);
        }
      }
      // ligação desfeita: sai na hora
      for (const id of [...bridges.keys()]) if (!seen.has(id)) await close(id);
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
