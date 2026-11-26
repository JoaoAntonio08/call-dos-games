/**
 * Novidades do Call dos Games, versão por versão, escritas para a turma (nada de detalhe de servidor).
 * A página /novidades e o aviso "O que mudou" dentro do app leem daqui.
 *
 * Para uma versão nova: ponha no TOPO da lista. `scene` escolhe o banner animado; `demo` põe uma
 * animaçãozinha no item; `media` aceita print ou GIF de verdade (arquivo em /public/novidades/).
 */

export type Scene = "cuidado" | "jogos" | "conquistas" | "servidor" | "radio" | "ponte" | "desktop";
export type Tag = "novo" | "melhorou" | "corrigido";
export type Demo = "impostor" | "forca" | "quina" | "mapa" | "musica" | "risada" | "recado" | "retro" | "placa" | "qualidade" | "eq";

export interface ChangeItem {
  emoji: string;
  title: string;
  text: string;
  demo?: Demo;
  media?: { src: string; alt: string; kind: "image" | "video" };
}

export interface Release {
  version: string;
  /** AAAA-MM-DD */
  date: string;
  title: string;
  summary: string;
  scene: Scene;
  groups: { tag: Tag; items: ChangeItem[] }[];
}

export const TAG_LABEL: Record<Tag, string> = { novo: "Novidades", melhorou: "Melhorias", corrigido: "Correções" };

export const RELEASES: Release[] = [
  {
    version: "2.5.3",
    date: "2026-11-26",
    title: "Privacidade em primeiro lugar",
    summary: "A retrospectiva deixa de fora tudo que nem todo mundo vê, e o clipe de risada só usa o que foi gravado depois que todo mundo aceitou.",
    scene: "cuidado",
    groups: [
      {
        tag: "corrigido",
        items: [
          {
            emoji: "📅",
            title: "Retrospectiva sem mensagens privadas",
            text: "Mensagens só para você, mensagens temporárias e canais fechados não contam mais no total, no ranking de quem mais falou nem no emoji do mês.",
          },
          {
            emoji: "😂",
            title: "Clipe de risada só com o que veio depois do OK",
            text: "Quando alguém entra, sai ou muda de ideia sobre o clipe, o que estava guardado é jogado fora. O clipe de risada só usa o que foi gravado com a mesma turma e todo mundo de acordo.",
            demo: "risada",
          },
        ],
      },
    ],
  },
  {
    version: "2.5.2",
    date: "2026-11-25",
    title: "Ajustes finos",
    summary: "Mudou a permissão de uma call? A retrospectiva respeita na hora. Os recados passam por uma conferência mais rigorosa e o Onde foi isso? aguenta melhor muita gente começando ao mesmo tempo.",
    scene: "cuidado",
    groups: [
      {
        tag: "corrigido",
        items: [
          {
            emoji: "🔒",
            title: "Permissões valem na hora",
            text: "Quando uma call vira restrita, ela sai da retrospectiva do servidor no mesmo instante, até no meio de um minigame.",
          },
          { emoji: "📼", title: "Recados conferidos de verdade", text: "O servidor toca o áudio do recado por dentro para medir o tempo, e recusa arquivo estragado ou que não veio do app." },
          { emoji: "🗺️", title: "Onde foi isso?", text: "Muitas partidas começando juntas não passam mais do limite do servidor." },
        ],
      },
    ],
  },
  {
    version: "2.5.1",
    date: "2026-11-25",
    title: "Mais cuidado com a call",
    summary: "O clipe de risada agora só acontece com o OK de todo mundo, a retrospectiva deixa as calls fechadas de fora e os jogos e recados ficaram mais firmes. E chegou esta página de novidades!",
    scene: "cuidado",
    groups: [
      {
        tag: "novo",
        items: [
          {
            emoji: "✨",
            title: "Página de novidades",
            text: "Tudo que muda no Call dos Games, com banner e animação, e um aviso de O que mudou quando sai versão nova. Para rever depois: Configurações › Novidades.",
          },
        ],
      },
      {
        tag: "melhorou",
        items: [
          {
            emoji: "😂",
            title: "Clipe de risada só com o OK de todo mundo",
            text: "Agora vem desligado. Ligue em Configurações › Voz e vídeo. O clipe só acontece quando todo mundo na call aceitou: se alguém não quiser, ninguém clipa. Quando está valendo, aparece 😂 Clipe de risada ligado no topo da call, e todo mundo é avisado quando um momento vira clipe.",
            demo: "risada",
          },
          {
            emoji: "📅",
            title: "Retrospectiva sem as calls fechadas",
            text: "O tempo em calls que só alguns cargos enxergam não entra mais nos rankings do servidor, e o Adivinhe a música não usa músicas que tocaram nelas.",
          },
        ],
      },
      {
        tag: "corrigido",
        items: [
          { emoji: "📼", title: "Recados", text: "O tempo do recado é conferido no próprio áudio, o limite de recados por call não estoura e áudio apagado sai de verdade do servidor." },
          { emoji: "🎮", title: "Minigames", text: "Jogadas ao mesmo tempo não contam ponto em dobro, e trocar ou encerrar um jogo para tudo que ele estava preparando." },
        ],
      },
    ],
  },
  {
    version: "2.5.0",
    date: "2026-11-24",
    title: "Minigames na call",
    summary: "Cinco jogos para jogar com a turma sem sair da call, clipe automático quando todo mundo ri, recado para quem chega depois e a retrospectiva do mês.",
    scene: "jogos",
    groups: [
      {
        tag: "novo",
        items: [
          {
            emoji: "🕵️",
            title: "Impostor",
            text: "Sorteia um tema e uma palavra, e um de vocês é o impostor. Joguem do jeito clássico (o impostor fica sem palavra) ou no modo traiçoeiro, em que ele recebe uma palavra parecida. Cada um dá uma dica e a turma vota em quem expulsar.",
            demo: "impostor",
          },
          {
            emoji: "🟩",
            title: "Quina",
            text: "Adivinhe a palavra de 5 letras com a turma. Acabou uma, já vem outra: não tem fim.",
            demo: "quina",
          },
          {
            emoji: "🌍",
            title: "Onde foi isso?",
            text: "Aparece uma foto de algum lugar do mundo e você marca no mapa onde acha que ela foi tirada. Quanto mais perto, mais ponto. No modo difícil ainda tem que chutar o ano.",
            demo: "mapa",
          },
          {
            emoji: "🎵",
            title: "Adivinhe a música",
            text: "Toca um trecho e quem acertar primeiro leva mais pontos. As músicas saem do que já tocou nas calls de vocês.",
            demo: "musica",
          },
          {
            emoji: "🔤",
            title: "Forca",
            text: "A forca de sempre, só que todo mundo chuta junto. Errar a palavra inteira custa caro.",
            demo: "forca",
          },
          {
            emoji: "😂",
            title: "Clipe de risada",
            text: "Quando a call inteira cai na gargalhada, o app guarda o momento sozinho. A risada é reconhecida no seu próprio aparelho, sem mandar seu áudio para lugar nenhum. Dá para desligar em Configurações › Voz e vídeo.",
            demo: "risada",
          },
          {
            emoji: "📼",
            title: "Recado na call vazia",
            text: "Entrou e não tinha ninguém? Grave um áudio de até 30 segundos. Quem entrar depois ouve. O recado some sozinho em 7 dias.",
            demo: "recado",
          },
          {
            emoji: "📅",
            title: "Retrospectiva do mês",
            text: "Uma página nova em cada servidor: quem mais ficou em call, quem mais falou, as músicas mais tocadas, o emoji do mês e a mensagem que mais bombou.",
            demo: "retro",
          },
          {
            emoji: "📺",
            title: "Visto na call",
            text: "Os vídeos do YouTube que vocês assistem juntos aparecem sozinhos na Lista do grupo.",
          },
          {
            emoji: "🤫",
            title: "Conquistas secretas",
            text: "Cinco placas novas. Ninguém sabe como liberar até alguém conseguir.",
          },
        ],
      },
    ],
  },
  {
    version: "2.4.1",
    date: "2026-11-22",
    title: "Ajustes nas conquistas",
    summary: "Conquistas liberam na hora certa, a lousa respeita quem desenhou e a fila de música não empaca.",
    scene: "conquistas",
    groups: [
      {
        tag: "corrigido",
        items: [
          { emoji: "⏱️", title: "Conquistas na hora certa", text: "A etapa só libera quando você chega às horas cheias. Antes, 4h57 em call já contava como 5 h." },
          { emoji: "✏️", title: "Lousa", text: "Cada traço fica com quem desenhou de verdade, então a regra de quem pode apagar vale sempre." },
          { emoji: "🎶", title: "Música automática", text: "Se a próxima da fila falha por causa da rede, ela tenta de novo em vez de ficar parada." },
        ],
      },
    ],
  },
  {
    version: "2.4.0",
    date: "2026-11-22",
    title: "Conquistas",
    summary: "Seu tempo em call e na tela vira enfeite de perfil, e o visual ficou mais limpo.",
    scene: "conquistas",
    groups: [
      {
        tag: "novo",
        items: [
          {
            emoji: "🏆",
            title: "Conquistas com enfeites",
            text: "Tempo em call, transmitindo e assistindo tela liberam enfeites para o seu perfil: aro que pulsa, nome em degradê, nome RGB, banner com brilho e placas holográficas que se inclinam quando você passa o mouse.",
            demo: "placa",
          },
          { emoji: "📊", title: "Quanto falta", text: "Em Configurações › Conquistas dá para ver o progresso de cada trilha." },
        ],
      },
      {
        tag: "melhorou",
        items: [
          { emoji: "🎨", title: "Aparência mais simples", text: "Tema Vidro ou Sólido, cor do vidro e abertura, tudo num lugar só. O vidro agora fica só no que flutua: janelas, menus e avisos." },
        ],
      },
    ],
  },
  {
    version: "2.3.2",
    date: "2026-11-22",
    title: "Música sem travar",
    summary: "A fila continua quando quem deu play sai da call.",
    scene: "radio",
    groups: [
      {
        tag: "corrigido",
        items: [
          { emoji: "▶️", title: "A fila não para", text: "Quem deu o último play saiu? A música continua para quem ficou. E pôr música com tudo parado já começa a tocar para todo mundo." },
          { emoji: "⚙️", title: "Perfil mais arrumado", text: "Trocar o @usuário fica só no Perfil, e a barra de salvar só aparece quando você muda algo." },
        ],
      },
    ],
  },
  {
    version: "2.3.0",
    date: "2026-11-21",
    title: "Call em casa e até 4K",
    summary: "A call agora roda no servidor da turma, com qualidade que se ajusta sozinha. Além disso, o Discord ficou mais completo e chegou o visual de vidro.",
    scene: "servidor",
    groups: [
      {
        tag: "novo",
        items: [
          {
            emoji: "🖥️",
            title: "Call no servidor da turma",
            text: "Sem franquia que acaba no meio do mês. Com o servidor folgado, a tela vai em 4K. Quando ele aperta, a qualidade cai sozinha, sem cortar a transmissão.",
            demo: "qualidade",
          },
          { emoji: "🧽", title: "Borracha na lousa", text: "A borracha e o Limpar o meu apagam só os seus traços." },
          { emoji: "🪟", title: "Visual de vidro", text: "Painéis translúcidos na cor do servidor ou na sua, com animação de entrada." },
        ],
      },
      {
        tag: "melhorou",
        items: [
          { emoji: "💬", title: "Discord mais completo", text: "Cartões de bots, prévias de link, figurinhas animadas e emojis próprios chegam do jeito que aparecem no Discord." },
          { emoji: "🔁", title: "Tentar de novo", text: "Quando a call não conecta, aparece um aviso claro com o botão para tentar de novo." },
        ],
      },
    ],
  },
  {
    version: "2.2.0",
    date: "2026-11-20",
    title: "Rádio da call",
    summary: "A música não acaba quando a fila acaba, e quem está no Discord entra na conversa de voz.",
    scene: "radio",
    groups: [
      {
        tag: "novo",
        items: [
          {
            emoji: "📻",
            title: "Rádio da call",
            text: "A fila acabou? Entra outra do mesmo artista ou do mesmo estilo, sem repetir e sem cover. Use /radio para ligar ou desligar.",
            demo: "eq",
          },
          { emoji: "🎧", title: "Calls do Discord aqui dentro", text: "Ligue uma call daqui a um canal de voz do Discord e todo mundo se ouve, dos dois lados." },
          { emoji: "🔔", title: "Avisos do seu jeito", text: "Som, pop-up, os dois ou nada, separado para DM, menção e servidor. São seis sons para escolher." },
        ],
      },
      {
        tag: "corrigido",
        items: [{ emoji: "📞", title: "Ligação no privado", text: "Ligar numa conversa individual voltou a tocar do outro lado." }],
      },
    ],
  },
  {
    version: "2.1.0",
    date: "2026-11-19",
    title: "Ponte com o Discord",
    summary: "Quem ainda está no Discord não fica de fora, e a turma ganhou a sua noite fixa.",
    scene: "ponte",
    groups: [
      {
        tag: "novo",
        items: [
          { emoji: "🌉", title: "Ponte com o Discord", text: "Um canal daqui fica espelhado com um de lá, nos dois sentidos, com nome, foto, imagens e GIFs." },
          { emoji: "🎉", title: "Noite da turma", text: "Marque a noite fixa: todo mundo responde Vou, Talvez ou Não vou. Na hora chega um aviso de Começou! com o botão para entrar na call." },
          { emoji: "🔇", title: "Tela sem eco", text: "Compartilhar a tela com som não leva mais as vozes da call junto (veio na 2.1.1)." },
        ],
      },
    ],
  },
  {
    version: "2.0.0",
    date: "2026-11-19",
    title: "App de Windows novo",
    summary: "O app de Windows foi refeito do zero: de 121 MB para 2 MB.",
    scene: "desktop",
    groups: [
      {
        tag: "novo",
        items: [
          { emoji: "🪶", title: "Levinho", text: "O instalador tem uns 2 MB, abre mais rápido e gasta menos memória. Tudo continua lá: bandeja, abrir com o Windows, Alt+Shift+C para clipar." },
          { emoji: "🔐", title: "Atualiza sozinho", text: "Desde a 2.0.1, o app só instala atualizações assinadas pelo Call dos Games." },
        ],
      },
    ],
  },
];

export const LATEST = RELEASES[0];

const MONTHS = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
export function dateLabel(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return `${d} de ${MONTHS[m - 1]} de ${y}`;
}

export const slugOf = (version: string) => `v${version.replace(/\./g, "-")}`;
