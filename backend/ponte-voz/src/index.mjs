// Ponte de voz do Call dos Games: liga as calls daqui às calls do Discord.
// A cada 3 s pergunta à API quais calls estão ligadas e se tem gente nos dois lados.
// Tem gente dos dois lados → o bot entra na call do Discord e a ponte entra na sala do LiveKit.
// Um dos lados ficou vazio por 20 s → sai das duas.
// A API passou 15 s sem confirmar as ligações → desliga todas até ela voltar (não toca com estado velho).
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
import { Reconciler, fetchState } from "./plan.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const POLL_MS = 3000;
const GRACE_MS = 20_000;
const API_TIMEOUT_MS = 5000; // a API não respondeu nisso: tenta na próxima volta
const START_TIMEOUT_MS = 45_000; // entrar nos dois lados (o Discord sozinho já tem 20 s)
const STALE_MS = 15_000; // a API não confirma as ligações há isso: desliga todas as pontes (fail-closed)

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

const client = await discordClient(process.env.DISCORD_BOT_TOKEN);
log(`ponte de voz no ar como ${client.user.tag}`);

const r = new Reconciler({
  fetchState: () => fetchState(API, process.env.DISCORD_VOICE_SECRET, { timeoutMs: API_TIMEOUT_MS }),
  makeBridge: async (link, { onClose }) => {
    const token = await bridgeToken({ key: process.env.LIVEKIT_API_KEY, secret: process.env.LIVEKIT_API_SECRET, room: link.room });
    return new CallBridge({
      makeDiscord: (cb) => new DiscordSide({ client, guildId: link.guild_id, channelId: link.discord_channel_id, ...cb }),
      makeApp: (cb) => new LiveKitSide({ url: process.env.LIVEKIT_URL, token, ...cb }),
      onClose,
    });
  },
  graceMs: GRACE_MS,
  staleMs: STALE_MS,
  startTimeoutMs: START_TIMEOUT_MS,
  log,
});

// relógio próprio: fecha por falta de confirmação mesmo se a volta estiver presa
setInterval(() => r.check(), 1000).unref();

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, async () => {
    await r.closeAll("serviço parando");
    await client.destroy();
    process.exit(0);
  });
}

for (;;) {
  await r.tick();
  await new Promise((res) => setTimeout(res, POLL_MS));
}
