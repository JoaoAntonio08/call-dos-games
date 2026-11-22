export type Presence = "online" | "idle" | "dnd" | "invisible" | "offline";

export interface Media {
  url: string;
  still: string;
  animated: boolean;
}

export interface User {
  id: string;
  username: string;
  display_name: string;
  bio: string;
  accent: string;
  pronouns: string;
  custom_status: string;
  status: Presence;
  avatar: Media | null;
  banner: Media | null;
  join_sound: string | null;
  created_at: string;
  /** cor do nome ("" = tom da cor do perfil) */
  name_color: string;
  /** tema do cartão: [cima, baixo] ou [] */
  theme: string[];
  badges: string[];
  /** enfeites de conquista que a pessoa escolheu mostrar */
  flair?: Flair;
  /** mensagem de webhook (bot) */
  bot?: boolean;
  /** veio pela ponte com o Discord */
  via?: "discord";
}

export interface Me extends User {
  email: string | null;
  has_password: boolean;
  has_google: boolean;
  /** admin da plataforma toda (vê o uso de todos os servidores) */
  platform_admin?: boolean;
}

export type Relation = "none" | "friends" | "outgoing" | "incoming" | "self";

export interface Friend {
  user: User;
  relation: Exclude<Relation, "none" | "self">;
}

export interface Channel {
  id: string;
  server_id: string | null;
  type: "text" | "voice";
  name: string;
  topic: string;
  position: number;
  last_message_id: string | null;
  /** cargos que veem o canal (vazio = todo mundo) */
  view_roles?: string[];
  /** cargos que escrevem (texto) ou falam (voz) no canal (vazio = todo mundo) */
  send_roles?: string[];
  /** sala de voz: máximo de pessoas (0 = sem limite) */
  user_limit?: number;
}

export type Perm = "musica" | "dj" | "comandos" | "hype" | "apelidos" | "moderar_voz" | "uso";

export interface Role {
  id: string;
  name: string;
  color: string;
  position: number;
  perms: Perm[];
}

export interface Member {
  user: User;
  role: "owner" | "admin" | "member";
  nickname: string;
  /** ids dos cargos da pessoa */
  roles?: string[];
  joined_at: string;
}

export interface Sound {
  id: string;
  name: string;
  emoji: string;
  url: string;
  volume: number;
  uploader_id: string | null;
}

export interface CustomEmoji {
  id: string;
  name: string;
  url: string;
  animated: boolean;
}

export interface Server {
  id: string;
  name: string;
  description: string;
  owner_id: string;
  accent: string;
  hall_threshold: number;
  /** segundos entre um hype e outro (0 = hype desligado) */
  hype_cooldown?: number;
  roles?: Role[];
  /** o que todo mundo do servidor pode, sem cargo nenhum */
  everyone_perms?: Perm[];
  /** o que EU posso neste servidor (dono e admins: tudo) */
  my_perms?: Perm[];
  /** frases de boas-vindas próprias, com {nome}; vazio = as padrão */
  welcome_lines: string[];
  icon: Media | null;
  banner: Media | null;
  channels: Channel[];
  members: Member[];
  sounds: Sound[];
  emojis: CustomEmoji[];
}

export interface Dm {
  id: string;
  type: "dm";
  recipients: User[];
  last_message_id: string | null;
}

export interface Attachment {
  /** GIF da busca não tem id: vem direto do GIPHY */
  id?: string;
  sticker?: boolean;
  gif?: boolean;
  url: string;
  name: string;
  mime: string;
  size: number;
  width: number | null;
  height: number | null;
  animated: boolean;
}

export interface Reaction {
  emoji: string;
  count: number;
  me: boolean;
}

/** Cartão de uma mensagem que veio do Discord (starboard, avisos de bot, prévia de link). */
export interface Embed {
  color: string | null;
  author: { name: string; icon: string; url: string } | null;
  title: string;
  url: string;
  description: string;
  fields: { name: string; value: string; inline: boolean }[];
  image: { url: string; width?: number | null; height?: number | null } | null;
  thumbnail: { url: string; width?: number | null; height?: number | null } | null;
  footer: { text: string; icon: string } | null;
  provider: string;
}

export interface Message {
  id: string;
  channel_id: string;
  author: User | null;
  content: string;
  kind: "default" | "join" | "system" | "hall" | "hype";
  attachments: Attachment[];
  /** cartões que vieram do Discord pela ponte */
  embeds?: Embed[];
  reply_to: { id: string; author_id: string | null; author_name: string; content: string; has_attachments: boolean } | null;
  reply_missing: boolean;
  reactions: Reaction[];
  edited_at: string | null;
  created_at: string;
  /** só quem enviou vê (comando de música e respostas dele); some sozinha */
  ephemeral?: boolean;
  expires_at?: string | null;
  /** só no cliente: mensagem ainda sendo enviada */
  pending?: boolean;
  nonce?: string;
}

/** O que o "DJ" está tocando numa call (aparece como mais um na call). */
export interface NowPlaying {
  video_id: string;
  title: string;
  author: string;
  owner_id: string;
  owner_name: string;
  playing: boolean;
}

export interface VoiceMember {
  user_id: string;
  mic: boolean;
  deaf: boolean;
  video: boolean;
  stream: boolean;
  since: number;
  /** mutado / sem som por um admin, para todos */
  smute?: boolean;
  sdeaf?: boolean;
  /** volume da pessoa para todos (0..1), escolhido por um admin */
  gain?: number;
  /** sem poder transmitir tela/câmera (passou do limite ou foi restringido) */
  noshare?: boolean;
}

export interface Game {
  name: string;
  appid: string;
  /** "app" quando veio do app de Windows (sem Steam) */
  source?: "app";
}

export interface Sticker {
  id: string;
  name: string;
  file_id: string;
  url: string;
  width: number | null;
  height: number | null;
  animated: boolean;
  favorite?: boolean;
  /** pasta da coleção ("" = sem pasta) */
  folder?: string;
}

export interface Gif {
  id: string;
  title: string;
  url: string;
  preview: string;
  width: number;
  height: number;
}

export interface SteamProfile {
  name: string;
  url: string;
  public: boolean;
  playing: Game | null;
  recent: { appid: string; name: string; hours_2weeks: number; hours_total: number; image: string }[];
}

/** Alguém que está na call do Discord ligada a um canal de voz daqui. */
export interface DiscordVoiceMember {
  id: string;
  name: string;
  avatar: string;
  mute: boolean;
  deaf: boolean;
}

export interface Bootstrap {
  me: Me;
  servers: Server[];
  dms: Dm[];
  friends: Friend[];
  read_states: Record<string, string>;
  voice: Record<string, VoiceMember[]>;
  music?: Record<string, NowPlaying>;
  /** quem está nas calls do Discord ligadas pela ponte de voz (canal de voz daqui -> pessoas) */
  discord_voice?: Record<string, DiscordVoiceMember[]>;
  livekit: boolean;
  livekit_cloud: boolean;
}

export interface HallEntry {
  message: Message;
  channel_name: string;
  added_at: string;
}

export interface QueueItem {
  id: string;
  video_id: string;
  start: number;
  title: string;
  author: string;
  added_by: string | null;
  voters: string[];
  created_at: string;
}

export type ShowKind = "anime" | "serie" | "filme" | "jogo" | "outro";
export type ShowStatus = "watching" | "paused" | "planned" | "done";

export interface Show {
  id: string;
  title: string;
  kind: ShowKind;
  status: ShowStatus;
  season: number | null;
  episode: number;
  total: number | null;
  note: string;
  created_by: string | null;
  updated_by: string | null;
  updated_at: string;
}

/** Enfeites de conquista (backend/app/conquistas.py). Vazio = normal. */
export interface Flair {
  name?: string;
  ring?: string;
  banner?: string;
  plate?: string;
}

export interface AchievementStep {
  at: number;
  reward: string;
  label: string;
  unlocked: boolean;
}
export interface AchievementTrack {
  id: string;
  name: string;
  unit: string;
  value: number;
  max: number;
  steps: AchievementStep[];
}
export interface Achievements {
  tracks: AchievementTrack[];
  unlocked: string[];
  flair: Flair;
}
