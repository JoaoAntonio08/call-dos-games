# Subindo o Call dos Games no servidor do seu amigo

The site keeps running on Vercel (free). On the server you only run:

- **API** (Python/FastAPI): accounts, servers, chat, DMs, uploads, gateway.
- **Postgres**, installed directly on the machine.
- **Caddy**, which provides HTTPS in front of the API.
- **LiveKit**, which carries the call's voice and video. This one is optional, see step 5.

Everything is free. The guide assumes Linux (Ubuntu/Debian) with `sudo`. Replace `api.exemplo.com` with the real subdomain (for example `cdg.seudominio.com`).

```
navegador ──HTTPS──> Vercel (site Next.js)
    │
    ├──HTTPS/WSS──> Cloudflare ──> Caddy :443 ──> API :8000 ──> Postgres :5432
    │                                                 └──> /var/lib/calldosgames/uploads
    └──WSS + UDP──> LiveKit (Cloud ou próprio)
```

## 1. Pacotes

```bash
sudo apt update
sudo apt install -y python3 python3-venv postgresql caddy git
python3 --version   # precisa ser 3.12 ou mais novo
```

## 2. Usuário, pastas e código

```bash
sudo useradd --system --create-home --home-dir /opt/calldosgames calldosgames
sudo mkdir -p /var/lib/calldosgames/uploads
sudo chown -R calldosgames: /var/lib/calldosgames
# copie a pasta backend/ do projeto para /opt/calldosgames/backend (git clone, scp, rsync...)
sudo chown -R calldosgames: /opt/calldosgames
sudo -u calldosgames bash -c 'cd /opt/calldosgames/backend && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt'
```

## 3. Postgres

Edit the password in `deploy/postgres.sql`, then run:

```bash
sudo -u postgres psql -f /opt/calldosgames/backend/deploy/postgres.sql
```

You don't need to create tables: the API creates them (and updates them) when it starts.

## 4. Configuração (`.env`)

```bash
cd /opt/calldosgames/backend
sudo -u calldosgames cp .env.example .env
sudo -u calldosgames nano .env
sudo chmod 600 .env
```

Fill in:

| Variable | Value |
|---|---|
| `DATABASE_URL` | Uses the password from step 3. |
| `JWT_SECRET` | `python3 -c "import secrets; print(secrets.token_urlsafe(48))"` |
| `PUBLIC_URL` | `https://api.exemplo.com` |
| `FRONTEND_URL` / `CORS_ORIGINS` | `https://call-dos-games.vercel.app` |
| `UPLOAD_DIR` | `/var/lib/calldosgames/uploads` |
| `LIVEKIT_*` | See step 5. |
| `GOOGLE_CLIENT_ID` | See step 8 (optional). |
| `BEHIND_CLOUDFLARE` | `1` if the subdomain has the orange cloud. |

## 5. Voz e vídeo: escolha um

**A) LiveKit Cloud** is the simplest option, and the one the 3-hour call already used:

- Use the same `LIVEKIT_URL`, `LIVEKIT_API_KEY` and `LIVEKIT_API_SECRET` that are already in Vercel.
- Nothing to install.
- Limit: the free plan's monthly bandwidth (4K screen sharing uses a lot of it).

**B) Your own LiveKit on the server** has no bandwidth limit, but it needs open ports:

```bash
curl -sSL https://get.livekit.io | bash          # instala /usr/local/bin/livekit-server
sudo cp deploy/livekit.yaml /etc/livekit.yaml     # e troque o segredo dentro dele
sudo cp deploy/livekit.service /etc/systemd/system/
sudo systemctl enable --now livekit
```

- In `.env`: `LIVEKIT_URL=wss://voz.exemplo.com`, plus the same key and secret as in `livekit.yaml`.
- **Cloudflare:** the `voz` subdomain must have the **grey cloud (DNS only)**. Cloudflare doesn't carry the call's UDP traffic.
- **Firewall / router:** open **TCP 443, TCP 7881 and UDP 50000–50200** to this machine. If it's behind a home router, forward these ports.

## 6. Caddy (HTTPS) e Cloudflare

```bash
sudo cp deploy/Caddyfile /etc/caddy/Caddyfile     # troque os domínios
sudo systemctl reload caddy
```

On Cloudflare:

- Create an `A` record for `api` pointing to the machine's IP. The orange cloud is fine; WebSocket works through it.
- Under SSL/TLS, use **Full (strict)** mode.
- If you chose option B, also create `voz` with the **grey** cloud.

## 7. Ligar a API

```bash
sudo cp deploy/calldosgames-api.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now calldosgames-api
curl https://api.exemplo.com/health                 # {"ok":true}
journalctl -u calldosgames-api -f                   # ver o log
```

> Keep `--workers 1`. Who's online, who's typing and who's in a call live in the process memory. With more than one worker, the friends would stop seeing each other.

## 8. Login com Google (opcional)

1. Go to <https://console.cloud.google.com>, then **APIs & Services → Credentials → Create credentials → OAuth client ID**, type **Web application**.
2. Under **Authorized JavaScript origins**, add `https://call-dos-games.vercel.app` (and `http://localhost:3000` if you want to test on your PC).
3. Copy the **Client ID** into `GOOGLE_CLIENT_ID` in `.env` and restart: `sudo systemctl restart calldosgames-api`.

The Google button appears on its own once the ID is set. The client secret isn't used.

## 9. E-mail de "esqueci a senha" (opcional)

Without configuration, the reset link shows up in `journalctl -u calldosgames-api`, and you can send it to the friend by hand. To send it by e-mail, create a free account at <https://resend.com>, verify the domain, and fill in `RESEND_API_KEY` and `EMAIL_FROM`.

## 10. Vercel

In the Vercel project → **Settings → Environment Variables**, create:

```
NEXT_PUBLIC_API_URL=https://api.exemplo.com
```

Then redeploy. `LIVEKIT_*` stays as it is in Vercel: the quick call by key (`/sala/...`) still uses it.

## 11. Backup

```bash
sudo -u calldosgames crontab -e
# adicione:
30 4 * * * bash /opt/calldosgames/backend/scripts/backup.sh
```

The script runs `pg_dump` on the database and packs the `uploads/` folder into `/var/lib/calldosgames/backups` (keeps 14 days). Copy that folder somewhere else from time to time.

## Atualizar

```bash
# copie a pasta backend nova por cima (sem apagar o .env), depois:
sudo -u calldosgames /opt/calldosgames/backend/.venv/bin/pip install -r /opt/calldosgames/backend/requirements.txt
sudo systemctl restart calldosgames-api
```
