// Mensagens de quando a call não conecta ou cai, em português de gente (o LiveKit só diz
// coisas como "Client initiated disconnect" ou "could not establish signal connection").
import { DisconnectReason } from "livekit-client";

export interface CallProblem {
  title: string;
  text: string;
  /** vale a pena oferecer "tentar de novo" */
  retry: boolean;
}

const OFFLINE: CallProblem = {
  title: "O servidor de voz não respondeu",
  text: "Pode ser a sua internet ou o servidor de voz fora do ar por um instante. Tenta de novo; se continuar, avisa quem cuida do servidor.",
  retry: true,
};

/** Erro ao entrar na call (o connect falhou ou a API recusou o token). */
export function problemFromError(e: unknown): CallProblem {
  const msg = e instanceof Error ? e.message : typeof e === "string" ? e : "";
  const low = msg.toLowerCase();
  // mensagens que já vêm da nossa API em português: mostra como estão
  if (/sala está cheia/i.test(msg)) return { title: "Sala cheia", text: msg, retry: false };
  if (/não está configurado|configuração do livekit/i.test(msg)) {
    return { title: "Call ainda não configurada", text: "O servidor de voz não foi configurado. Quem cuida do servidor precisa ligar o LiveKit.", retry: false };
  }
  if (/não encontrado/i.test(msg)) return { title: "Call não encontrada", text: "Essa call não existe mais ou você perdeu o acesso a ela.", retry: false };
  if (/permission|not allowed|unauthorized|401|403|token/.test(low)) {
    return { title: "Entrada recusada", text: "O servidor de voz não aceitou a entrada. Atualiza a página e tenta de novo.", retry: true };
  }
  if (/quota|limit|exceeded|payment|billing/.test(low)) {
    return { title: "Servidor de voz no limite", text: "O servidor de voz atingiu o limite de uso. Quem cuida do servidor já pode resolver; tenta de novo mais tarde.", retry: true };
  }
  // "Client initiated disconnect", "could not establish signal connection", websocket, timeout, rede...
  if (!msg || /disconnect|signal|websocket|timeout|timed out|network|failed to fetch|abort|connection|ice|pc connection/.test(low)) return OFFLINE;
  // qualquer outra coisa em inglês técnico: não assusta ninguém com ela
  return /[ãõçáéíóúâêô]/i.test(msg) ? { title: "Não deu para entrar na call", text: msg, retry: true } : OFFLINE;
}

/** A call caiu sem você clicar em sair. null = não precisa avisar (saiu de propósito ou já tem aviso próprio). */
export function problemFromDisconnect(reason: DisconnectReason | undefined): CallProblem | null {
  switch (reason) {
    case undefined:
    case DisconnectReason.CLIENT_INITIATED:
    case DisconnectReason.DUPLICATE_IDENTITY:
    case DisconnectReason.PARTICIPANT_REMOVED:
      return null;
    case DisconnectReason.ROOM_DELETED:
      return { title: "A call foi encerrada", text: "A sala foi fechada no servidor. Dá para entrar de novo quando quiser.", retry: true };
    case DisconnectReason.SERVER_SHUTDOWN:
      return { title: "O servidor de voz reiniciou", text: "Normalmente volta em alguns segundos. Clica em entrar de novo.", retry: true };
    default:
      return { title: "A call caiu", text: "A conexão com o servidor de voz se perdeu. Confere a internet e entra de novo.", retry: true };
  }
}
