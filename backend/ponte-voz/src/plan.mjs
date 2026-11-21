// O que fazer a cada volta: quais pontes fechar e quais abrir, a partir das calls ligadas que a API informa.
// Fica separado do index.mjs para dar para testar sem Discord nem LiveKit.
//
// Regras:
// - Ligação desfeita: fecha na hora.
// - Ligação trocada de destino (outro canal do Discord, outro servidor, outra sala): fecha a antiga já,
//   senão o áudio continua indo para o lugar velho. A nova abre na volta seguinte.
// - Um lado ficou vazio: fecha depois do tempo de tolerância.
// - Um bot só fica numa call por servidor do Discord: duas calls daqui ligadas a canais do mesmo servidor
//   não disputam a conexão. Quem pegou primeiro fica; a outra espera o servidor liberar.

/** O destino da ponte: se qualquer um destes mudar, a ponte aberta já não serve. */
export function target(link) {
  return `${link.guild_id}/${link.discord_channel_id}/${link.room}`;
}

/**
 * @param {Array<object>} links                       o que a API respondeu (links[])
 * @param {Map<string, {link: object, idleSince: number | null}>} bridges   pontes abertas, por canal daqui
 * @param {object} o
 * @param {number} o.now
 * @param {Map<string, number>} o.retryAt                canal -> quando pode tentar de novo
 * @param {number} o.graceMs
 * @returns {{close: Array<{id: string, why: string}>, open: object[], waiting: Array<{link: object, holder: string}>}}
 */
export function plan(links, bridges, { now, retryAt, graceMs }) {
  const close = [];
  const closing = new Set();
  const byId = new Map(links.map((l) => [l.channel_id, l]));

  for (const [id, entry] of bridges) {
    const link = byId.get(id);
    if (!link) {
      close.push({ id, why: "ligação desfeita" });
      closing.add(id);
    } else if (target(link) !== target(entry.link)) {
      close.push({ id, why: "ligação trocou de destino" });
      closing.add(id);
    } else if (link.active) {
      entry.idleSince = null;
    } else {
      entry.idleSince ??= now;
      if (now - entry.idleSince > graceMs) {
        close.push({ id, why: "um dos lados ficou vazio" });
        closing.add(id);
      }
    }
  }

  // servidores do Discord que já têm o bot numa call (das pontes que continuam abertas)
  const guildHolder = new Map();
  for (const [id, entry] of bridges) if (!closing.has(id)) guildHolder.set(entry.link.guild_id, id);

  const open = [];
  const waiting = [];
  for (const link of links) {
    if (!link.active || bridges.has(link.channel_id) || closing.has(link.channel_id)) continue;
    if ((retryAt.get(link.channel_id) ?? 0) > now) continue;
    const holder = guildHolder.get(link.guild_id);
    if (holder !== undefined) {
      waiting.push({ link, holder });
      continue;
    }
    guildHolder.set(link.guild_id, link.channel_id);
    open.push(link);
  }
  return { close, open, waiting };
}

/** Promessa com prazo: passou do tempo, rejeita (quem chamou limpa o que ficou pela metade). */
export function withTimeout(promise, ms, what) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what}: passou de ${Math.round(ms / 1000)} s`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/** Pergunta à API o estado das calls ligadas, sem nunca ficar presa esperando. */
export async function fetchState(api, secret, { timeoutMs = 5000, fetchImpl = fetch } = {}) {
  const r = await fetchImpl(`${api}/internal/discord-voice`, {
    headers: { "x-bridge-secret": secret },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!r.ok) throw new Error(`API respondeu ${r.status}`);
  return r.json();
}
