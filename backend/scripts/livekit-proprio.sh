#!/usr/bin/env bash
# Liga o LiveKit no próprio servidor (sai do LiveKit Cloud, que tem franquia mensal).
# Rode UMA vez, trocando o domínio pelo subdomínio que vai carregar a voz:
#
#   sudo bash /opt/calldosgames/app/backend/scripts/livekit-proprio.sh voz-call.zapeu.net
#
# Antes de rodar:
#   1. Na Cloudflare, crie o registro A "voz-call" apontando para o IP desta máquina, com a nuvem CINZA (DNS only).
#   2. Se a máquina estiver atrás de um roteador, redirecione TCP 7881 e UDP 50000-50200 para ela.
#
# O que ele faz: instala o livekit-server, gera a chave, cria /etc/livekit.yaml e o serviço,
# põe o domínio no Caddy (HTTPS automático), troca o LIVEKIT_* do backend/.env e do .env.local
# (guarda cópia dos antigos em *.antes-livekit-proprio) e reinicia API, site e ponte de voz.
# Para voltar para a nuvem: copie os arquivos *.antes-livekit-proprio de volta e reinicie.
set -euo pipefail

DOMINIO="${1:-}"
APP=/opt/calldosgames/app
CADDY=/etc/caddy/Caddyfile
if [[ -z "$DOMINIO" || "$DOMINIO" == -* ]]; then
  echo "uso: sudo bash $0 voz-call.seudominio.com" >&2
  exit 1
fi
if [[ $EUID -ne 0 ]]; then
  echo "rode com sudo" >&2
  exit 1
fi

echo "==> 1/6 livekit-server"
if ! command -v livekit-server >/dev/null; then
  curl -sSL https://get.livekit.io | bash
fi
livekit-server --version

echo "==> 2/6 configuração (/etc/livekit.yaml)"
if [[ -f /etc/livekit.yaml ]] && grep -q "^  cdg: " /etc/livekit.yaml && ! grep -q "TROQUE_POR" /etc/livekit.yaml; then
  SEGREDO=$(sed -n 's/^  cdg: //p' /etc/livekit.yaml | tr -d '"' | head -1)
  echo "    já existia: mantendo a mesma chave"
else
  SEGREDO=$(openssl rand -hex 32)
  sed "s/TROQUE_POR_UM_SEGREDO_LONGO/$SEGREDO/" "$APP/backend/deploy/livekit.yaml" > /etc/livekit.yaml
fi
chmod 600 /etc/livekit.yaml

echo "==> 3/6 serviço"
cp "$APP/backend/deploy/livekit.service" /etc/systemd/system/livekit.service
systemctl daemon-reload
systemctl enable --now livekit
systemctl restart livekit

echo "==> 4/6 Caddy (HTTPS de $DOMINIO)"
if ! grep -qE "^${DOMINIO//./\\.}[[:space:]]*\{" "$CADDY"; then
  cp "$CADDY" "$CADDY.antes-livekit-proprio"
  printf '\n# LiveKit próprio (voz e vídeo). Na Cloudflare: nuvem CINZA.\n%s {\n\treverse_proxy 127.0.0.1:7880\n}\n' "$DOMINIO" >> "$CADDY"
fi
caddy validate --config "$CADDY" --adapter caddyfile >/dev/null
systemctl reload caddy

echo "==> 5/6 portas"
if command -v ufw >/dev/null && ufw status | grep -q "Status: active"; then
  ufw allow 7881/tcp >/dev/null
  ufw allow 50000:50200/udp >/dev/null
  echo "    ufw: liberei TCP 7881 e UDP 50000-50200"
else
  echo "    sem ufw ativo; confira o firewall/roteador: TCP 7881 e UDP 50000-50200"
fi

echo "==> 6/6 LIVEKIT_* no backend/.env e no .env.local"
troca() { # arquivo, chave, valor
  if grep -q "^$2=" "$1"; then sed -i "s|^$2=.*|$2=$3|" "$1"; else echo "$2=$3" >> "$1"; fi
}
for f in "$APP/backend/.env" "$APP/.env.local"; do
  [[ -f "$f" ]] || continue
  [[ -f "$f.antes-livekit-proprio" ]] || cp -p "$f" "$f.antes-livekit-proprio"
  troca "$f" LIVEKIT_URL "wss://$DOMINIO"
  troca "$f" LIVEKIT_API_KEY cdg
  troca "$f" LIVEKIT_API_SECRET "$SEGREDO"
done

systemctl restart calldosgames-api calldosgames-site
if systemctl is-enabled --quiet calldosgames-ponte-voz 2>/dev/null; then systemctl restart calldosgames-ponte-voz; fi

sleep 3
if curl -fsS --max-time 5 http://127.0.0.1:7880 >/dev/null; then
  echo "    LiveKit respondendo na máquina"
else
  echo "    ATENÇÃO: o LiveKit não respondeu. Veja: journalctl -u livekit -n 30" >&2
fi
if curl -fsS --max-time 10 "https://$DOMINIO" >/dev/null 2>&1; then
  echo "    https://$DOMINIO respondendo"
else
  echo "    https://$DOMINIO ainda não responde (o DNS pode levar uns minutos; confira a nuvem cinza na Cloudflare)"
fi
echo "pronto: entrem numa call para testar"
