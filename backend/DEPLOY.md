# Subindo o Call dos Games no servidor do seu amigo

Tudo fica no servidor dele, sem Vercel:

- **Site** (Next.js, Node): as páginas que a turma abre no navegador.
- **API** (Python/FastAPI): contas, servidores, chat, DMs, arquivos e o tempo real (gateway).
- **Postgres**, instalado direto na máquina.
- **Caddy**, que dá o HTTPS na frente do site e da API.
- **LiveKit**, que carrega a voz e o vídeo da call. Pode ser o LiveKit Cloud (grátis) ou um próprio, veja o passo 6.

Tudo de graça. O guia assume Linux (Ubuntu/Debian) com `sudo`. Troque `cdg.exemplo.com` pelo domínio de vocês: o site fica em `cdg.exemplo.com` e a API em `api.cdg.exemplo.com`.

```
navegador ──HTTPS──> Cloudflare ──> Caddy :443 ─┬─> site :3000 (Node)
    │                                           └─> API  :8000 ──> Postgres :5432
    │                                                  └──> /var/lib/calldosgames/uploads
    └──WSS + UDP──> LiveKit (Cloud ou próprio)
```

## 1. Pacotes

```bash
sudo apt update
sudo apt install -y python3 python3-venv postgresql caddy git curl
python3 --version   # precisa ser 3.12 ou mais novo

# Node 22 (o do apt costuma ser velho demais para o Next.js 16)
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
node --version      # precisa ser 20.9 ou mais novo
```

## 2. Usuário, pastas e código

```bash
sudo useradd --system --create-home --home-dir /opt/calldosgames calldosgames
sudo mkdir -p /var/lib/calldosgames/uploads
sudo chown -R calldosgames: /var/lib/calldosgames
sudo -u calldosgames git clone https://github.com/JoaoAntonio08/call-dos-games.git /opt/calldosgames/app
sudo -u calldosgames bash -c 'cd /opt/calldosgames/app/backend && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt'
```

## 3. Postgres

Troque a senha em `backend/deploy/postgres.sql` e rode:

```bash
sudo -u postgres psql -f /opt/calldosgames/app/backend/deploy/postgres.sql
```

Não precisa criar tabelas: a API cria (e atualiza) sozinha quando liga.

## 4. Configuração da API (`backend/.env`)

```bash
cd /opt/calldosgames/app/backend
sudo -u calldosgames cp .env.example .env
sudo -u calldosgames nano .env
sudo chmod 600 .env
```

Preencha:

| Variável | Valor |
|---|---|
| `DATABASE_URL` | Com a senha do passo 3. |
| `JWT_SECRET` | `python3 -c "import secrets; print(secrets.token_urlsafe(48))"` |
| `PUBLIC_URL` | `https://api.cdg.exemplo.com` |
| `FRONTEND_URL` / `CORS_ORIGINS` | `https://cdg.exemplo.com` |
| `UPLOAD_DIR` | `/var/lib/calldosgames/uploads` |
| `LIVEKIT_*` | Veja o passo 6. |
| `GOOGLE_CLIENT_ID` | Veja o passo 9 (opcional). |
| `BEHIND_CLOUDFLARE` | `1` se o subdomínio estiver com a nuvem laranja. |

## 5. Configuração do site (`.env.local`)

```bash
cd /opt/calldosgames/app
sudo -u calldosgames cp .env.example .env.local
sudo -u calldosgames nano .env.local
sudo chmod 600 .env.local
```

| Variável | Valor |
|---|---|
| `NEXT_PUBLIC_API_URL` | `https://api.cdg.exemplo.com` |
| `LIVEKIT_URL` / `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET` | Os mesmos do `backend/.env`. |

> O `NEXT_PUBLIC_API_URL` entra no build do site. Se mudar, rode o `atualizar.sh` (passo 8) de novo.

## 6. Voz e vídeo: escolha um

**A) LiveKit Cloud** é o mais simples:

- Crie um projeto em <https://cloud.livekit.io> e, em **Settings → Keys**, pegue a URL, a API Key e o API Secret.
- Nada para instalar.
- Limite: a banda mensal do plano grátis (compartilhar tela em 4K gasta bastante).

**B) LiveKit próprio no servidor** não tem limite de banda, mas precisa de portas abertas:

```bash
curl -sSL https://get.livekit.io | bash                                # instala /usr/local/bin/livekit-server
sudo cp /opt/calldosgames/app/backend/deploy/livekit.yaml /etc/livekit.yaml   # e troque o segredo dentro dele
sudo cp /opt/calldosgames/app/backend/deploy/livekit.service /etc/systemd/system/
sudo systemctl enable --now livekit
```

- Nos dois `.env`: `LIVEKIT_URL=wss://voz.cdg.exemplo.com`, com a mesma chave e segredo do `livekit.yaml`.
- **Cloudflare:** o subdomínio `voz` precisa ficar com a **nuvem cinza (DNS only)**. A Cloudflare não carrega o tráfego UDP da call.
- **Firewall / roteador:** abra **TCP 443, TCP 7881 e UDP 50000–50200** para esta máquina. Se ela estiver atrás de um roteador de casa, redirecione essas portas.

## 7. Caddy (HTTPS) e Cloudflare

```bash
sudo cp /opt/calldosgames/app/backend/deploy/Caddyfile /etc/caddy/Caddyfile   # troque os domínios
sudo systemctl reload caddy
```

Na Cloudflare:

- Crie registros `A` para `cdg` e `api.cdg` apontando para o IP da máquina. A nuvem laranja pode ficar; o WebSocket passa por ela.
- Em SSL/TLS, use o modo **Full (strict)**.
- Se escolheu a opção B, crie também `voz.cdg` com a nuvem **cinza**.

## 8. Ligar a API e o site

```bash
sudo cp /opt/calldosgames/app/backend/deploy/calldosgames-api.service /etc/systemd/system/
sudo cp /opt/calldosgames/app/backend/deploy/calldosgames-site.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable calldosgames-api calldosgames-site
# faz o build do site e liga os dois (uns 2 minutos)
sudo bash /opt/calldosgames/app/backend/scripts/atualizar.sh --sem-pull
curl https://api.cdg.exemplo.com/health            # {"ok":true}
curl -I https://cdg.exemplo.com                    # 200
journalctl -u calldosgames-api -f                  # log da API
journalctl -u calldosgames-site -f                 # log do site
```

> Mantenha `--workers 1` na API. Quem está online, quem está digitando e quem está em call ficam na memória do processo. Com mais de um worker, os amigos deixariam de se ver.

## 9. Login com Google (opcional)

1. Em <https://console.cloud.google.com>, vá em **APIs e serviços → Credenciais → Criar credenciais → ID do cliente OAuth**, tipo **Aplicativo da Web**.
2. Em **Origens JavaScript autorizadas**, adicione `https://cdg.exemplo.com` (e `http://localhost:3000` se quiser testar no PC).
3. Copie o **ID do cliente** para `GOOGLE_CLIENT_ID` no `backend/.env` e reinicie: `sudo systemctl restart calldosgames-api`.

O botão do Google aparece sozinho quando o ID está preenchido. A "chave secreta do cliente" não é usada.

## 10. E-mail de "esqueci a senha" (opcional)

Sem configurar, o link de redefinir aparece em `journalctl -u calldosgames-api`, e dá para mandar para o amigo na mão. Para enviar por e-mail, crie uma conta grátis em <https://resend.com>, verifique o domínio e preencha `RESEND_API_KEY` e `EMAIL_FROM`.

## 11. GIFs e Steam (opcional)

- **GIFs no chat:** crie uma conta em <https://developers.giphy.com>, clique em **Create an API Key** (tipo *API*), e coloque a chave em `GIPHY_API_KEY`.
- **Steam ("jogando agora" e jogos recentes):** entre na Steam e pegue a chave em <https://steamcommunity.com/dev/apikey> (no domínio pode colocar o do site). Coloque em `STEAM_API_KEY`.

Depois: `sudo systemctl restart calldosgames-api`. Sem as chaves, o resto funciona e o app só avisa que essas partes estão desligadas. Cada pessoa liga a própria Steam em **Configurações → Jogos**, colando o link do perfil (o perfil e os detalhes de jogo precisam estar públicos na Steam).

Quem usa o app de Windows também aparece como "Jogando X" sem Steam: o app reconhece o jogo aberto no PC (lista em `desktop/jogos.js`, e cada um pode adicionar o seu em **Configurações → Jogos**).

### Comandos de bot

`/dado`, `/moeda`, `/sortear`, `/escolher` e `/ajuda` já vêm prontos. Em **Configurações do servidor → Bots**, cada webhook pode ganhar comandos próprios e um endereço `https://` público: quando alguém usa o comando, a API faz um `POST` JSON (`{type, command, args, user, channel_id, server_id, message_id, timestamp}`) para esse endereço, com o cabeçalho `X-CDG-Signature: sha256=<HMAC-SHA256 do corpo>`, usando como chave o sha256 (em hexadecimal) do token do webhook. A resposta no formato do Discord (`{"content": "..."}`) vira mensagem do bot; resposta vazia (204) deixa o bot responder depois pelo próprio webhook. A API só chama endereços públicos (nada de `localhost` ou rede interna).

## 12. Backup

```bash
sudo -u calldosgames crontab -e
# adicione:
30 4 * * * bash /opt/calldosgames/app/backend/scripts/backup.sh
```

O script roda `pg_dump` no banco e empacota a pasta `uploads/` em `/var/lib/calldosgames/backups` (guarda 14 dias). De vez em quando, copie essa pasta para outro lugar.

## Atualizar

Depois de cada `git push` no GitHub:

```bash
sudo bash /opt/calldosgames/app/backend/scripts/atualizar.sh
```

Ele baixa a versão nova, instala o que mudou, refaz o build do site e reinicia a API e o site. Os `.env`, o banco e os arquivos enviados não são tocados.

O arquivo `public/apps/versao.json` diz qual é a versão mais nova dos apps de Windows e Android. Os apps leem esse arquivo no site e avisam a turma quando sai versão nova (no Windows, o app baixa e instala sozinho). Então, depois de publicar uma versão nova dos apps no GitHub, é só rodar o `atualizar.sh` que o aviso aparece para todo mundo.

## Trazer os dados do PC (opcional)

Se a turma já usou o servidor que rodava no PC, leve os dados junto antes de ligar a API pela primeira vez:

```bash
# no PC (pasta backend):  pg_dump -h 127.0.0.1 -p 5433 -U cdg -Fc calldosgames_prod > cdg.dump   (senha: a do DATABASE_URL do .env.prod)
# no servidor:
sudo -u calldosgames pg_restore --no-owner --dbname="$(grep ^DATABASE_URL= /opt/calldosgames/app/backend/.env | cut -d= -f2-)" cdg.dump
# e copie o conteúdo de backend/uploads-prod do PC para /var/lib/calldosgames/uploads
```
