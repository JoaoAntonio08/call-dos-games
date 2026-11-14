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
}

export interface Me extends User {
  email: string | null;
  has_password: boolean;
  has_google: boolean;
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
}

export interface Member {
  user: User;
  role: "owner" | "admin" | "member";
  nickname: string;
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
  id: string;
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

export interface Message {
  id: string;
  channel_id: string;
  author: User | null;
  content: string;
  kind: "default" | "join" | "system" | "hall";
  attachments: Attachment[];
  reply_to: { id: string; author_id: string | null; author_name: string; content: string; has_attachments: boolean } | null;
  reply_missing: boolean;
  reactions: Reaction[];
  edited_at: string | null;
  created_at: string;
  /** só no cliente: mensagem ainda sendo enviada */
  pending?: boolean;
  nonce?: string;
}

export interface VoiceMember {
  user_id: string;
  mic: boolean;
  deaf: boolean;
  video: boolean;
  stream: boolean;
  since: number;
}

export interface Bootstrap {
  me: Me;
  servers: Server[];
  dms: Dm[];
  friends: Friend[];
  read_states: Record<string, string>;
  voice: Record<string, VoiceMember[]>;
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
