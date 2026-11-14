# Call dos Games

O cantinho da turma: um "Discord nosso", com Nitro liberado para todo mundo.

- **Contas** com e-mail e senha ou Google, foto de perfil e banner (estáticos ou **animados**), bio, pronomes, cor de destaque e status
- **Servidores** com canais de texto e de voz, convites por link, cargos (dono, admin, membro), ícone e banner animados
- **Chat**: formatação (negrito, itálico, código, spoiler, citação), menções, respostas, reações, emojis próprios do servidor, anexos até 25 MB, "fulano está digitando"
- **Mensagens diretas** e lista de amigos
- **Call** com tela de 720p a 4K, câmera, push-to-talk, supressão de ruído, volume por pessoa, e a call continua enquanto você navega pelo app
- **Soundboard** do servidor e **som de entrada** de cada pessoa
- **Atividades na call**: YouTube sincronizado, lousa compartilhada, roleta e reações flutuando na tela
- A **call rápida por chave** (`/sala/sua-chave`) continua existindo, sem precisar de conta

Feito com Next.js 16, Tailwind 4 e [LiveKit](https://livekit.io) no site, e FastAPI + Postgres na API (pasta `backend/`).

## Hospedagem

| Parte | Onde | Custo |
|---|---|---|
| Site (Next.js) | servidor do amigo (ou Vercel) | grátis |
| API + Postgres + arquivos | servidor do amigo | grátis |
| Voz e vídeo | LiveKit Cloud (plano grátis) ou LiveKit no mesmo servidor | grátis |

O passo a passo para hospedar tudo (site, API e banco) no servidor do amigo está em [backend/DEPLOY.md](backend/DEPLOY.md). Atualizar depois: `sudo bash /opt/calldosgames/app/backend/scripts/atualizar.sh`.

## Servidor da turma no seu PC (enquanto o amigo não hospeda)

Tudo de graça: o banco e a API rodam neste PC, e um túnel da Cloudflare (sem conta) dá um endereço HTTPS para a turma.

1. **Uma vez só:** abra `backend/.env.prod` e cole em `LIVEKIT_URL`, `LIVEKIT_API_KEY` e `LIVEKIT_API_SECRET` as mesmas chaves do LiveKit Cloud que estão na Vercel (em <https://cloud.livekit.io> → Settings → Keys). Sem isso o chat funciona, mas a call não.
2. **Para ligar:** clique duas vezes em `backend/Ligar servidor.cmd`. Ele liga o Postgres, a API e o túnel. Se o endereço do túnel mudou (muda toda vez que liga), ele grava o novo na Vercel e republica o site sozinho, em cerca de 1 minuto.
3. **Para desligar:** `backend/Desligar servidor.cmd`.
4. **Liga sozinho com o Windows:** tem um atalho "Call dos Games - servidor" na pasta Inicialização (Win+R, `shell:startup`). Ele espera a internet, liga tudo escondido e mostra um aviso só se der errado (log em `backend/logs/inicio.log`). Para parar de ligar sozinho, apague o atalho.

O PC precisa ficar ligado enquanto a turma usa. Os dados ficam no banco `calldosgames_prod` (cluster em `backend/.pgdata`, porta 5433) e os arquivos em `backend/uploads-prod`. Os logs ficam em `backend/logs`.

Quando o amigo for hospedar, siga [backend/DEPLOY.md](backend/DEPLOY.md). Para levar os dados junto, use `pg_dump` do banco `calldosgames_prod` e copie a pasta `uploads-prod`.

## Rodar tudo no seu PC

1. Postgres rodando e um banco vazio. Copie `backend/.env.example` para `backend/.env` e preencha (`PUBLIC_URL=http://localhost:8000`, `FRONTEND_URL` e `CORS_ORIGINS` com `http://localhost:3000`, `BEHIND_CLOUDFLARE=0`).
2. API:

```bash
cd backend
python -m venv .venv
.venv/Scripts/pip install -r requirements.txt
.venv/Scripts/python -m uvicorn app.main:app --port 8000
```

3. LiveKit local (veja abaixo) e o site com `npm run dev`. Abra <http://localhost:3000>.

## 1. Criar o servidor LiveKit (grátis)

1. Crie uma conta em <https://cloud.livekit.io> e crie um projeto.
2. Em **Settings → Keys**, crie uma chave e copie a **URL** (`wss://...livekit.cloud`), a **API Key** e o **API Secret**.
3. Na pasta do projeto, copie `.env.example` para `.env.local` e preencha:

```
LIVEKIT_URL=wss://seu-projeto.livekit.cloud
LIVEKIT_API_KEY=...
LIVEKIT_API_SECRET=...
```

> Transmitir em 4K gasta muita banda do plano grátis do LiveKit Cloud. Veja os limites atuais em <https://livekit.io/pricing>. Para uso pesado, dá para rodar o `livekit-server` num VPS próprio.

### Testar sem conta (só no seu PC)

Baixe o `livekit-server` em <https://github.com/livekit/livekit/releases> (arquivo `windows_amd64.zip`) e rode:

```bash
livekit-server.exe --dev --bind 127.0.0.1
```

E use no `.env.local`:

```
LIVEKIT_URL=ws://localhost:7880
LIVEKIT_API_KEY=devkey
LIVEKIT_API_SECRET=secret
```

Assim funciona entre abas do seu próprio PC. Para os amigos entrarem pela internet, use o LiveKit Cloud.

## 2. Rodar só o site

```bash
npm install
npm run dev
```

Abra <http://localhost:3000>. Para os amigos entrarem de fora, publique o site (próximo passo).

## 3. Publicar (Vercel)

### Caminho curto: direto da linha de comando

```bash
npx vercel login
npx vercel link
npx vercel env add LIVEKIT_URL production
npx vercel env add LIVEKIT_API_KEY production
npx vercel env add LIVEKIT_API_SECRET production
npx vercel env add NEXT_PUBLIC_API_URL production
npx vercel --prod
```

O último comando imprime o link do site. A sala fica em `https://seu-site.vercel.app/sala/sua-chave`.

### Pelo GitHub (atualiza sozinho a cada push)

1. Suba o projeto para um repositório no GitHub.
2. Em <https://vercel.com>, importe o repositório.
3. Em **Environment Variables**, cadastre as mesmas três variáveis do `.env.local`.
4. Faça o deploy e mande o link `https://seu-site.vercel.app/sala/sua-chave` para a turma.

## Dicas

| Situação | O que fazer |
|---|---|
| Tela compartilhada sem som | Use **Chrome ou Edge** e marque **"Compartilhar áudio"** na janela de escolha. O Firefox não captura o som do sistema. |
| Tela preta no jogo | Deixe o jogo em **tela cheia sem bordas** (borderless) ou compartilhe a tela inteira. |
| Tela preta na Netflix, Crunchyroll etc. | É a proteção DRM do serviço e acontece em qualquer site. Use o modo YouTube ou arquivos locais. |
| Imagem engasgando | Desça a resolução ou os fps. 4K 60 precisa de uns 25 Mbps de upload estáveis. |
| Eco do anime na sua voz | Use fone de ouvido. |

Upload necessário (aproximado, para quem compartilha):

| | 30 fps | 60 fps |
|---|---|---|
| 720p | 2,5 Mbps | 4 Mbps |
| 1080p | 5 Mbps | 8 Mbps |
| 1440p | 9 Mbps | 14 Mbps |
| 4K | 16 Mbps | 25 Mbps |

## Visual

Aconchegante, de noite com abajur: fundo cacau (`#15110f` a `#463b33`), texto aveia `#f1e6d4` e destaque brasa `#e3713f`. Duas fontes: Fraunces nos títulos e Figtree no resto. Grão leve por cima, cantos pequenos, sem sombras pesadas.

## Estrutura

```
app/page.tsx                    página inicial
app/app/                        o app (servidores, chat, DMs, call): tudo num layout só, a call não cai ao navegar
app/entrar, criar-conta, ...    login, cadastro e senha
app/convite/[code]              página do convite
app/sala/[key]                  call rápida por chave
components/app/*                trilho, barras laterais, chat, perfil, modais, tela da call
lib/store.ts                    estado do app e gateway (WebSocket)
lib/voice.tsx                   call do servidor: entrar, sair, soundboard, atividades
lib/use-call.ts                 conexão do LiveKit, microfone, câmera e tela
backend/app/                    API: auth, usuários, servidores, mensagens, arquivos, gateway
backend/app/schema.sql          tabelas (a API aplica sozinha ao subir)
backend/deploy/                 Postgres, systemd, Caddy e LiveKit para o servidor
```
