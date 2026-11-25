-- Call dos Games: esquema do banco. Idempotente: roda inteiro a cada inicialização.

CREATE TABLE IF NOT EXISTS files (
    id          BIGINT PRIMARY KEY,
    owner_id    BIGINT,
    kind        TEXT NOT NULL,              -- avatar | banner | icon | attachment | sound | emoji
    mime        TEXT NOT NULL,
    size        INTEGER NOT NULL,
    name        TEXT NOT NULL DEFAULT '',
    width       INTEGER,
    height      INTEGER,
    animated    BOOLEAN NOT NULL DEFAULT FALSE,
    path        TEXT NOT NULL,
    still_path  TEXT,                       -- primeiro quadro, para imagens animadas
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE files ADD COLUMN IF NOT EXISTS stored_size BIGINT;
UPDATE files SET stored_size = size WHERE stored_size IS NULL;
ALTER TABLE files ALTER COLUMN stored_size SET NOT NULL;

CREATE TABLE IF NOT EXISTS users (
    id             BIGINT PRIMARY KEY,
    username       TEXT NOT NULL,
    display_name   TEXT NOT NULL,
    email          TEXT,
    password_hash  TEXT,
    google_sub     TEXT,
    avatar_id      BIGINT REFERENCES files(id) ON DELETE SET NULL,
    banner_id      BIGINT REFERENCES files(id) ON DELETE SET NULL,
    join_sound_id  BIGINT REFERENCES files(id) ON DELETE SET NULL,
    bio            TEXT NOT NULL DEFAULT '',
    accent         TEXT NOT NULL DEFAULT '#5865f2',
    status         TEXT NOT NULL DEFAULT 'online',   -- online | idle | dnd | invisible
    custom_status  TEXT NOT NULL DEFAULT '',
    pronouns       TEXT NOT NULL DEFAULT '',
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS users_username_key ON users (lower(username));
CREATE UNIQUE INDEX IF NOT EXISTS users_email_key ON users (lower(email)) WHERE email IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS users_google_key ON users (google_sub) WHERE google_sub IS NOT NULL;

CREATE TABLE IF NOT EXISTS sessions (
    id          BIGINT PRIMARY KEY,
    user_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    user_agent  TEXT NOT NULL DEFAULT '',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS password_resets (
    token_hash  TEXT PRIMARY KEY,
    user_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at  TIMESTAMPTZ NOT NULL,
    used        BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS servers (
    id           BIGINT PRIMARY KEY,
    name         TEXT NOT NULL,
    description  TEXT NOT NULL DEFAULT '',
    owner_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    icon_id      BIGINT REFERENCES files(id) ON DELETE SET NULL,
    banner_id    BIGINT REFERENCES files(id) ON DELETE SET NULL,
    accent       TEXT NOT NULL DEFAULT '#5865f2',
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS members (
    server_id  BIGINT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role       TEXT NOT NULL DEFAULT 'member',   -- owner | admin | member
    nickname   TEXT NOT NULL DEFAULT '',
    joined_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (server_id, user_id)
);
CREATE INDEX IF NOT EXISTS members_user_idx ON members (user_id);

CREATE TABLE IF NOT EXISTS channels (
    id          BIGINT PRIMARY KEY,
    server_id   BIGINT REFERENCES servers(id) ON DELETE CASCADE,   -- NULL = conversa direta
    type        TEXT NOT NULL,                                     -- text | voice | dm
    name        TEXT NOT NULL DEFAULT '',
    topic       TEXT NOT NULL DEFAULT '',
    position    INTEGER NOT NULL DEFAULT 0,
    last_message_id BIGINT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS channels_server_idx ON channels (server_id);

CREATE TABLE IF NOT EXISTS dm_participants (
    channel_id  BIGINT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    user_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    PRIMARY KEY (channel_id, user_id)
);
CREATE INDEX IF NOT EXISTS dm_user_idx ON dm_participants (user_id);

CREATE TABLE IF NOT EXISTS messages (
    id           BIGINT PRIMARY KEY,
    channel_id   BIGINT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    author_id    BIGINT REFERENCES users(id) ON DELETE SET NULL,
    content      TEXT NOT NULL DEFAULT '',
    reply_to     BIGINT,
    attachments  JSONB NOT NULL DEFAULT '[]',
    kind         TEXT NOT NULL DEFAULT 'default',   -- default | join | system | hall
    edited_at    TIMESTAMPTZ,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS messages_channel_idx ON messages (channel_id, id DESC);

CREATE TABLE IF NOT EXISTS reactions (
    message_id  BIGINT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    user_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    emoji       TEXT NOT NULL,
    PRIMARY KEY (message_id, user_id, emoji)
);

CREATE TABLE IF NOT EXISTS read_states (
    user_id       BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    channel_id    BIGINT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    last_read_id  BIGINT NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, channel_id)
);

CREATE TABLE IF NOT EXISTS invites (
    code        TEXT PRIMARY KEY,
    server_id   BIGINT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    creator_id  BIGINT REFERENCES users(id) ON DELETE SET NULL,
    uses        INTEGER NOT NULL DEFAULT 0,
    max_uses    INTEGER,
    expires_at  TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS friendships (
    requester_id  BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    addressee_id  BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status        TEXT NOT NULL DEFAULT 'pending',   -- pending | accepted
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (requester_id, addressee_id)
);
CREATE INDEX IF NOT EXISTS friendships_addressee_idx ON friendships (addressee_id);

CREATE TABLE IF NOT EXISTS sounds (
    id           BIGINT PRIMARY KEY,
    server_id    BIGINT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    uploader_id  BIGINT REFERENCES users(id) ON DELETE SET NULL,
    name         TEXT NOT NULL,
    emoji        TEXT NOT NULL DEFAULT '',
    file_id      BIGINT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
    volume       REAL NOT NULL DEFAULT 1,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sounds_server_idx ON sounds (server_id);

CREATE TABLE IF NOT EXISTS emojis (
    id          BIGINT PRIMARY KEY,
    server_id   BIGINT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    file_id     BIGINT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS emojis_name_key ON emojis (server_id, lower(name));

-- paleta nova (2026-11): cor padrão de quem nunca escolheu uma
ALTER TABLE users ALTER COLUMN accent SET DEFAULT '#5865f2';
ALTER TABLE servers ALTER COLUMN accent SET DEFAULT '#5865f2';
UPDATE users SET accent = '#5865f2' WHERE accent = '#d9663a';
UPDATE servers SET accent = '#5865f2' WHERE accent = '#d9663a';

-- Hall da Fama: mensagem que juntou reação de N pessoas diferentes
ALTER TABLE servers ADD COLUMN IF NOT EXISTS hall_threshold INT NOT NULL DEFAULT 3;
CREATE TABLE IF NOT EXISTS hall_entries (
    message_id  BIGINT PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE,
    server_id   BIGINT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    added_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS hall_entries_server ON hall_entries (server_id, added_at DESC);

-- fila de vídeos de cada canal de voz (ou conversa)
CREATE TABLE IF NOT EXISTS queue_items (
    id          BIGINT PRIMARY KEY,
    channel_id  BIGINT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    video_id    TEXT NOT NULL,
    start_at    INT NOT NULL DEFAULT 0,
    title       TEXT NOT NULL DEFAULT '',
    author      TEXT NOT NULL DEFAULT '',
    added_by    BIGINT REFERENCES users(id) ON DELETE SET NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS queue_items_channel ON queue_items (channel_id);
CREATE TABLE IF NOT EXISTS queue_votes (
    item_id  BIGINT NOT NULL REFERENCES queue_items(id) ON DELETE CASCADE,
    user_id  BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    PRIMARY KEY (item_id, user_id)
);

-- "onde paramos": o que a turma está assistindo e em que episódio parou
CREATE TABLE IF NOT EXISTS shows (
    id          BIGINT PRIMARY KEY,
    server_id   BIGINT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    title       TEXT NOT NULL,
    kind        TEXT NOT NULL DEFAULT 'anime',     -- anime | serie | filme | jogo | outro
    status      TEXT NOT NULL DEFAULT 'watching',  -- watching | paused | planned | done
    season      INT,
    episode     INT NOT NULL DEFAULT 0,
    total       INT,
    note        TEXT NOT NULL DEFAULT '',
    created_by  BIGINT REFERENCES users(id) ON DELETE SET NULL,
    updated_by  BIGINT REFERENCES users(id) ON DELETE SET NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS shows_server ON shows (server_id, updated_at DESC);

-- personalização (2026-11): tema do perfil, cor do nome, insígnias, boas-vindas do servidor
ALTER TABLE users ADD COLUMN IF NOT EXISTS name_color TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN IF NOT EXISTS theme TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE users ADD COLUMN IF NOT EXISTS badges TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE servers ADD COLUMN IF NOT EXISTS welcome_lines TEXT[] NOT NULL DEFAULT '{}';

-- moderação de voz (2026-11): admin muta/ensurdece para todos e ajusta o volume de alguém para todos
CREATE TABLE IF NOT EXISTS voice_mods (
    server_id  BIGINT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    mute       BOOLEAN NOT NULL DEFAULT false,
    deaf       BOOLEAN NOT NULL DEFAULT false,
    gain       REAL NOT NULL DEFAULT 1,
    PRIMARY KEY (server_id, user_id)
);

-- figurinhas próprias (coleção de cada pessoa)
CREATE TABLE IF NOT EXISTS stickers (
    id          BIGINT PRIMARY KEY,
    user_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name        TEXT NOT NULL DEFAULT '',
    file_id     BIGINT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS stickers_user_file ON stickers (user_id, file_id);
-- organizar a coleção: favoritas e pastas
ALTER TABLE stickers ADD COLUMN IF NOT EXISTS favorite BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE stickers ADD COLUMN IF NOT EXISTS folder TEXT NOT NULL DEFAULT '';

-- Steam: o que a pessoa está jogando
ALTER TABLE users ADD COLUMN IF NOT EXISTS steam_id TEXT NOT NULL DEFAULT '';

-- webhooks: bots e serviços de fora mandam mensagem num canal
CREATE TABLE IF NOT EXISTS webhooks (
    id          BIGINT PRIMARY KEY,
    channel_id  BIGINT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    token_hash  TEXT NOT NULL,
    created_by  BIGINT REFERENCES users(id) ON DELETE SET NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE messages ADD COLUMN IF NOT EXISTS webhook_id BIGINT;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS author_name TEXT NOT NULL DEFAULT '';
-- comandos com barra dos bots: a API chama o endereço do bot quando alguém usa um deles
ALTER TABLE webhooks ADD COLUMN IF NOT EXISTS command_url TEXT NOT NULL DEFAULT '';
ALTER TABLE webhooks ADD COLUMN IF NOT EXISTS commands TEXT[] NOT NULL DEFAULT '{}';
-- hype: de quanto em quanto tempo dá para chamar a turma (0 = desligado)
ALTER TABLE servers ADD COLUMN IF NOT EXISTS hype_cooldown INT NOT NULL DEFAULT 120;

-- ------------------------------------------------------------------ cargos e permissões
-- cargos próprios do servidor (além de dono/admin/membro); perms é a lista de coisas liberadas
CREATE TABLE IF NOT EXISTS roles (
    id         BIGINT PRIMARY KEY,
    server_id  BIGINT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    name       TEXT NOT NULL,
    color      TEXT NOT NULL DEFAULT '',
    position   INT NOT NULL DEFAULT 0,
    perms      TEXT[] NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS roles_server ON roles (server_id);
CREATE TABLE IF NOT EXISTS member_roles (
    server_id BIGINT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    user_id   BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role_id   BIGINT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    PRIMARY KEY (user_id, role_id)
);
CREATE INDEX IF NOT EXISTS member_roles_server ON member_roles (server_id, user_id);
-- o que todo mundo do servidor pode, sem cargo nenhum
ALTER TABLE servers ADD COLUMN IF NOT EXISTS everyone_perms TEXT[] NOT NULL DEFAULT '{musica,comandos,hype}';
-- canal restrito: só esses cargos veem / escrevem (ou falam, no canal de voz). Vazio = todo mundo
ALTER TABLE channels ADD COLUMN IF NOT EXISTS view_roles BIGINT[] NOT NULL DEFAULT '{}';
ALTER TABLE channels ADD COLUMN IF NOT EXISTS send_roles BIGINT[] NOT NULL DEFAULT '{}';

-- ------------------------------------------------------------------ mensagens que só quem digitou vê (somem sozinhas)
ALTER TABLE messages ADD COLUMN IF NOT EXISTS visible_to BIGINT;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS messages_expires ON messages (expires_at) WHERE expires_at IS NOT NULL;

-- ------------------------------------------------------------------ bots montados sem código
CREATE TABLE IF NOT EXISTS server_bots (
    id         BIGINT PRIMARY KEY,
    server_id  BIGINT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    name       TEXT NOT NULL,
    color      TEXT NOT NULL DEFAULT '#5865f2',
    modules    JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS server_bots_server ON server_bots (server_id);

-- uso de transmissão (tela/câmera) por pessoa e dia; scope = id do servidor (0 = conversas diretas)
CREATE TABLE IF NOT EXISTS share_usage (
    scope     BIGINT NOT NULL,
    user_id   BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    day       DATE NOT NULL,
    seconds   INT NOT NULL DEFAULT 0,
    bytes_up  BIGINT NOT NULL DEFAULT 0,
    bytes_out BIGINT NOT NULL DEFAULT 0,
    PRIMARY KEY (scope, user_id, day)
);
CREATE INDEX IF NOT EXISTS share_usage_day ON share_usage (day);
-- quem está sem poder transmitir; scope = servidor (0 = a plataforma toda); until NULL = até liberar
CREATE TABLE IF NOT EXISTS share_blocks (
    scope      BIGINT NOT NULL,
    user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    until      TIMESTAMPTZ,
    reason     TEXT NOT NULL DEFAULT 'manual',
    by_id      BIGINT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (scope, user_id)
);
ALTER TABLE servers ADD COLUMN IF NOT EXISTS share_limit JSONB NOT NULL DEFAULT '{}';

-- jogos grátis da Steam que o bot de jogos já avisou em cada servidor
CREATE TABLE IF NOT EXISTS free_games_seen (
    server_id BIGINT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    giveaway  TEXT NOT NULL,
    seen_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (server_id, giveaway)
);

-- limite de pessoas numa sala de voz (0 = sem limite)
ALTER TABLE channels ADD COLUMN IF NOT EXISTS user_limit INT NOT NULL DEFAULT 0;

-- ponte com o Discord: um canal de texto daqui espelhado com um canal do Discord
ALTER TABLE messages ADD COLUMN IF NOT EXISTS author_avatar TEXT NOT NULL DEFAULT '';
-- quem escreveu do lado de fora (id do Discord): separa as pessoas que chegam pela ponte
ALTER TABLE messages ADD COLUMN IF NOT EXISTS author_ext TEXT NOT NULL DEFAULT '';
CREATE TABLE IF NOT EXISTS discord_links (
    channel_id         BIGINT PRIMARY KEY REFERENCES channels(id) ON DELETE CASCADE,
    discord_channel_id TEXT NOT NULL UNIQUE,
    discord_guild_id   TEXT NOT NULL,
    discord_name       TEXT NOT NULL DEFAULT '',
    guild_name         TEXT NOT NULL DEFAULT '',
    webhook_id         TEXT NOT NULL,
    webhook_token      TEXT NOT NULL,
    created_by         BIGINT REFERENCES users(id) ON DELETE SET NULL,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Ponte de voz: um canal de voz daqui ligado a um canal de voz do Discord (o áudio passa pelo serviço ponte-voz)
CREATE TABLE IF NOT EXISTS discord_voice_links (
    channel_id         BIGINT PRIMARY KEY REFERENCES channels(id) ON DELETE CASCADE,
    discord_channel_id TEXT NOT NULL UNIQUE,
    discord_guild_id   TEXT NOT NULL,
    discord_name       TEXT NOT NULL DEFAULT '',
    guild_name         TEXT NOT NULL DEFAULT '',
    created_by         BIGINT REFERENCES users(id) ON DELETE SET NULL,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Noite da turma: evento marcado (ex.: sexta 21h), com lembrete, call pronta e presença registrada
CREATE TABLE IF NOT EXISTS server_events (
    id               BIGINT PRIMARY KEY,
    server_id        BIGINT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    title            TEXT NOT NULL,
    description      TEXT NOT NULL DEFAULT '',
    starts_at        TIMESTAMPTZ NOT NULL,
    duration_min     INT NOT NULL DEFAULT 180,
    weekly           BOOLEAN NOT NULL DEFAULT false,
    voice_channel_id BIGINT REFERENCES channels(id) ON DELETE SET NULL,
    text_channel_id  BIGINT REFERENCES channels(id) ON DELETE SET NULL,
    activity         TEXT NOT NULL DEFAULT '',
    media_url        TEXT NOT NULL DEFAULT '',
    remind_min       INT NOT NULL DEFAULT 30,
    reminded_for     TIMESTAMPTZ,
    started_for      TIMESTAMPTZ,
    created_by       BIGINT REFERENCES users(id) ON DELETE SET NULL,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS server_events_server ON server_events (server_id, starts_at);
CREATE TABLE IF NOT EXISTS event_rsvps (
    event_id BIGINT NOT NULL REFERENCES server_events(id) ON DELETE CASCADE,
    user_id  BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status   TEXT NOT NULL,
    PRIMARY KEY (event_id, user_id)
);
-- presença de cada noite (fica mesmo se o evento for apagado)
CREATE TABLE IF NOT EXISTS event_attendance (
    server_id BIGINT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    night     TIMESTAMPTZ NOT NULL,
    user_id   BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    event_id  BIGINT NOT NULL,
    title     TEXT NOT NULL DEFAULT '',
    seconds   INT NOT NULL DEFAULT 0,
    PRIMARY KEY (server_id, night, user_id)
);

-- ponte com o Discord: cartões (embeds) das mensagens de lá, como o do starboard da Loritta
ALTER TABLE messages ADD COLUMN IF NOT EXISTS embeds JSONB NOT NULL DEFAULT '[]';

-- conquistas: horas contadas pelo servidor e o enfeite que cada pessoa escolheu mostrar
CREATE TABLE IF NOT EXISTS user_stats (
    user_id        BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    call_seconds   BIGINT NOT NULL DEFAULT 0,
    share_seconds  BIGINT NOT NULL DEFAULT 0,
    watch_seconds  BIGINT NOT NULL DEFAULT 0
);
ALTER TABLE users ADD COLUMN IF NOT EXISTS flair JSONB NOT NULL DEFAULT '{}';

-- minigames, recados e retrospectiva (2026-11)
CREATE TABLE IF NOT EXISTS user_secrets (
    user_id      BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    code         TEXT NOT NULL,
    unlocked_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, code)
);
CREATE TABLE IF NOT EXISTS user_counters (
    user_id  BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    key      TEXT NOT NULL,
    n        BIGINT NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, key)
);
CREATE TABLE IF NOT EXISTS stats_monthly (
    server_id      BIGINT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    user_id        BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    month          TEXT NOT NULL,              -- AAAA-MM (horário de Brasília)
    call_seconds   BIGINT NOT NULL DEFAULT 0,
    share_seconds  BIGINT NOT NULL DEFAULT 0,
    watch_seconds  BIGINT NOT NULL DEFAULT 0,
    games_won      INT NOT NULL DEFAULT 0,
    PRIMARY KEY (server_id, user_id, month)
);
-- o que tocou no YouTube da call: jogo de música, "visto na call" e retrospectiva
CREATE TABLE IF NOT EXISTS music_log (
    id          BIGSERIAL PRIMARY KEY,
    server_id   BIGINT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    channel_id  BIGINT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    video_id    TEXT NOT NULL,
    title       TEXT NOT NULL DEFAULT '',
    author      TEXT NOT NULL DEFAULT '',
    played_by   BIGINT REFERENCES users(id) ON DELETE SET NULL,
    from_radio  BOOLEAN NOT NULL DEFAULT FALSE,
    played_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS music_log_server ON music_log (server_id, played_at DESC);
-- recado de voz deixado na call vazia (some sozinho em 7 dias)
CREATE TABLE IF NOT EXISTS recados (
    id          BIGINT PRIMARY KEY,
    channel_id  BIGINT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    author_id   BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    file_id     BIGINT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
    seconds     INT NOT NULL DEFAULT 0,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS recados_channel ON recados (channel_id, created_at DESC);
CREATE INDEX IF NOT EXISTS recados_file ON recados (file_id);
CREATE TABLE IF NOT EXISTS recado_ouvidos (
    recado_id  BIGINT NOT NULL REFERENCES recados(id) ON DELETE CASCADE,
    user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    PRIMARY KEY (recado_id, user_id)
);
