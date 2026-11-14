#!/usr/bin/env bash
# Baixa a versão nova do GitHub e reconstrói API + site. Rode com:  sudo bash /opt/calldosgames/app/backend/scripts/atualizar.sh
# Sem 'git pull' (só reconstruir):                                 sudo bash .../atualizar.sh --sem-pull
set -euo pipefail
APP=/opt/calldosgames/app
as_app() { sudo -u calldosgames -H bash -c "cd $APP && $1"; }

if [[ "${1:-}" != "--sem-pull" ]]; then
  echo "==> baixando a versão nova"
  as_app "git pull --ff-only"
fi

echo "==> API: dependências do Python"
as_app "backend/.venv/bin/pip install -q -r backend/requirements.txt"

echo "==> site: dependências e build (uns 2 minutos)"
# o .env.local tem o NEXT_PUBLIC_API_URL, que entra no build
as_app "npm ci --no-audit --no-fund && npm run build"
as_app "rm -rf .next/standalone/public .next/standalone/.next/static && cp -r public .next/standalone/ && cp -r .next/static .next/standalone/.next/"

echo "==> reiniciando"
systemctl restart calldosgames-api calldosgames-site
sleep 3
systemctl --no-pager --lines=0 status calldosgames-api calldosgames-site | grep -E "●|Active"
echo "pronto"
