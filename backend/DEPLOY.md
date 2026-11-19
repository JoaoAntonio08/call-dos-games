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

Sem configurar e-mail, a recuperação fica desativada: tokens de redefinição nunca devem aparecer no journal. Para enviar por e-mail, crie uma conta em <https://resend.com>, verifique o domínio e preencha `RESEND_API_KEY` e `EMAIL_FROM`.

## 11. GIFs, Steam e música pelo nome (opcional)

- **GIFs no chat:** crie uma conta em <https://developers.giphy.com>, clique em **Create an API Key** (tipo *API*), e coloque a chave em `GIPHY_API_KEY`.
- **Steam ("jogando agora" e jogos recentes):** entre na Steam e pegue a chave em <https://steamcommunity.com/dev/apikey> (no domínio pode colocar o do site). Coloque em `STEAM_API_KEY`.
- **/tocar pelo nome da música:** em <https://console.cloud.google.com> crie um projeto, ative a **YouTube Data API v3** (APIs e serviços → Biblioteca) e crie uma **chave de API** (APIs e serviços → Credenciais). Coloque em `YOUTUBE_API_KEY`. Sem ela, o /tocar funciona só com link do YouTube. A cota grátis dá umas 100 buscas por dia.

Depois: `sudo systemctl restart calldosgames-api`. Sem as chaves, o resto funciona e o app só avisa que essas partes estão desligadas. Cada pessoa liga a própria Steam em **Configurações → Jogos**, colando o link do perfil (o perfil e os detalhes de jogo precisam estar públicos na Steam).

Quem usa o app de Windows também aparece como "Jogando X" sem Steam: o app reconhece o jogo aberto no PC (lista em `desktop/jogos.js`, e cada um pode adicionar o seu em **Configurações → Jogos**).

### Cargos, música e bots sem código

- **Cargos** (Configurações do servidor → Cargos): cada cargo libera permissões (pôr música, DJ, comandos, hype, apelidos, moderar call). "Todo mundo" vale para quem não tem cargo; dono e admins podem tudo. Em **Canais**, cada canal pode ficar visível só para alguns cargos, e só alguns podem escrever (texto) ou falar (voz; os outros só escutam).
- **Música:** `/tocar nome ou link` põe na fila da call de quem pediu; `/fila` e `/pular` também. O comando e a resposta só aparecem para quem digitou e somem em 12 horas. Só quem pôs a música (ou DJ/admin) pausa e pula; os outros votam (mais da metade da call pula). Cada um tem o próprio volume.
- **Bots sem código** (Configurações do servidor → Bots): o bot junta módulos (música, diversão, enquete, boas-vindas, respostas automáticas, filtro de palavras, lembretes e cargo automático), escolhendo canais e cargos. Lembretes usam o horário de Brasília.
- **Bot de jogos** (módulo Jogos no criador de bots): `/jogo nome` procura o jogo na Steam (preço em reais, gêneros, lançamento, nota) e `/gratis` mostra os jogos que estão de graça na Steam agora. Se escolher um canal em "Avisar jogos grátis da Steam sozinho em", a API posta lá cada jogo grátis novo (confere a cada 30 minutos). Usa a loja da Steam e o GamerPower, **sem chave**.
  - `FREE_GAMES_CHECK_SECONDS` ajusta o intervalo (padrão `1800`, limitado entre `300` e `86400`).
  - `STEAM_STORE_BASE` e `GAMERPOWER_BASE` são substituições para laboratório; em produção, deixe-as ausentes para usar os endpoints oficiais.
- **DJ da call:** quando a música toca, aparece um "DJ" na lista da sala de voz (todo mundo vê, mesmo quem está fora) e avisos de "tocando agora" e "entrou na fila". A música segue num mini player no canto quando a pessoa vai para um canal de texto, sem sair da call.

### Salas, avisos e app de Windows

- **Limite de pessoas** (Configurações do servidor → Canais, em cada sala de voz): 0 é sem limite. Sala cheia barra quem chega; quem pode moderar a call entra assim mesmo.
- **Avisos:** DM e menção (`@nome`, `@todos`) tocam um som e mostram aviso (notificação do Windows se a janela estiver em segundo plano). Botão direito no canal ou no servidor: **Marcar como lida**, **Silenciar**. Cada um ajusta em **Configurações → Notificações**.
- **App de Windows 2.0.0 (Rust/Tauri, pasta `desktop-tauri/`):** substitui o de Electron (`desktop/`, mantido de reserva). Instalador de ~2 MB que tira o app antigo sozinho; quem troca precisa entrar na conta de novo uma vez. Como antes, o app só abre o site.
- **App de Windows (desde 1.4.0):** fechar no X deixa o app na bandeja (perto do relógio) com a call rolando; "Fechar de vez" e "Sair da call" ficam no menu da bandeja. Em **Configurações → App de Windows**: abrir junto com o Windows, abrir escondido e continuar rodando ao fechar.

### Uso de transmissão (tela e câmera)

- O app de cada pessoa conta a cada 30 segundos quanto ela enviou de tela e câmera; a API multiplica por quem está assistindo ("saindo do servidor", o que pesa na banda). Voz, música e YouTube junto não entram.
- **Configurações do servidor → Uso** (dono, admins e cargos com a permissão "Ver uso"): ranking de hoje, 7 ou 30 dias, quem está ao vivo, **Restringir** (1 hora, 1 dia, 7 dias ou até liberar) e **Liberar**. Restringido fica sem tela e câmera naquele servidor, com aviso; o microfone continua.
- **Limite automático** na mesma aba: X GB por pessoa por dia ou por mês. Quem passa fica sem tela e câmera até o fim do dia/mês (horário de Brasília). Dono e admins não entram no limite.
- **Admin da plataforma:** use `PLATFORM_ADMIN_IDS=123456...` no `backend/.env` (IDs imutáveis separados por vírgula). Vazio significa que ninguém tem esse poder. O ID aparece no perfil técnico/API e não muda quando o `@` muda. A variável antiga `PLATFORM_ADMINS`, baseada em nome, é ignorada e deve ser removida da configuração.

### Comandos de bot

`/dado`, `/moeda`, `/sortear`, `/escolher` e `/ajuda` já vêm prontos. Em **Configurações do servidor → Webhooks**, cada webhook pode ganhar comandos próprios e um endereço `https://` público: quando alguém usa o comando, a API faz um `POST` JSON (`{type, command, args, user, channel_id, server_id, message_id, timestamp}`) para esse endereço, com o cabeçalho `X-CDG-Signature: sha256=<HMAC-SHA256 do corpo>`, usando como chave o sha256 (em hexadecimal) do token do webhook. A resposta no formato do Discord (`{"content": "..."}`) vira mensagem do bot; resposta vazia (204) deixa o bot responder depois pelo próprio webhook. A API resolve o DNS uma vez, rejeita qualquer resposta local/privada/reservada, conecta diretamente ao IP público validado e não segue redirecionamentos.

Para enviar mensagens pelo webhook, use o endereço sem segredo e mande o token no cabeçalho `Authorization: Bearer ...` ou `X-Webhook-Token`. O token aparece somente na criação. Integrações antigas com token no caminho da URL devem ser recriadas ao adotar esta versão.

### Ponte com o Discord (opcional)

Espelha um canal de texto daqui com um canal do Discord, nos dois sentidos: o que a turma escreve lá aparece aqui com nome, foto, imagens e GIFs (selo **Discord**), e o que vocês escrevem aqui aparece lá com o nome e a foto de quem mandou.

1. Em <https://discord.com/developers/applications>, **New Application** (ex.: "Call dos Games"). Na aba **Bot**: ligue **Message Content Intent** e deixe **Public Bot** desligado. Clique em **Reset Token** e copie o token (ele só aparece uma vez).
2. No servidor, coloque o token no `backend/.env` (`DISCORD_BOT_TOKEN=...`) e reinicie a API (o `atualizar.sh` já reinicia). Não precisa abrir porta: o bot só faz conexões de saída para o Discord.
3. No site, **Configurações do servidor → Ponte com o Discord** mostra "Bot … conectado" e o botão **Pôr o bot no seu Discord** (convite já com as permissões certas: ver canais, mandar mensagens, links, arquivos, histórico e **Gerenciar webhooks**).
4. Clique em **Ligar ao Discord** no canal daqui. Aparece um comando tipo `!ponte ABCD-1234` (vale 10 minutos). Alguém que administra o servidor do Discord (dono, Administrador, Gerenciar servidor ou Gerenciar canais) digita isso no canal de lá. A tela atualiza sozinha.
5. Para desligar: o botão **Desligar** aqui, ou `!ponte desligar` no canal do Discord.

Detalhes: o bot cria um webhook "Call dos Games" no canal do Discord para mandar as mensagens daqui (se alguém apagar o webhook, a ponte desliga e avisa). Ninguém é marcado com @everyone de nenhum lado. Imagens que vêm do Discord são guardadas aqui (até 10 MB cada) e contam na cota de quem ligou a ponte. Edições e exclusões não são copiadas. O token nunca vai para o site nem para o git. `DISCORD_API_BASE` existe só para testes com um Discord de mentira; em produção deixe sem definir.

### Noite da turma

Página nova em cada servidor (ao lado do Hall da Fama). Admins marcam a noite (ex.: toda sexta 21h), escolhem a sala de voz, o canal dos avisos, o que vai rolar (vídeo ou música do YouTube começam sozinhos quando a turma entra pelo aviso) e o lembrete. Todo mundo responde Vou/Talvez/Não vou, recebe o lembrete antes e o aviso de "começou" na hora (quem respondeu "não vou" não é incomodado). Durante a noite a API conta quanto tempo cada um ficou na call; no fim manda o resumo no canal e a presença vai para o **Hall da presença**. Não precisa configurar nada. `NOITES_TICK` e `NOITES_MIN_PRESENCE` existem só para testes rápidos.

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
