// Copia o motor (wasm) do MediaPipe Audio para public/mediapipe antes do dev/build.
// O detector de risada roda no navegador de cada um e carrega daqui, do próprio site:
// nada vem de CDN de fora. (Os arquivos são grandes, por isso não ficam no git.)
import { copyFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const from = join(root, "node_modules", "@mediapipe", "tasks-audio", "wasm");
const to = join(root, "public", "mediapipe");

if (!existsSync(from)) {
  console.warn("[mediapipe] pacote não instalado: o clipe de risada fica desligado");
  process.exit(0);
}
mkdirSync(to, { recursive: true });
for (const f of readdirSync(from)) {
  if (/^audio_wasm_internal\.(js|wasm)$/.test(f)) copyFileSync(join(from, f), join(to, f));
}
console.log("[mediapipe] wasm copiado para public/mediapipe");
