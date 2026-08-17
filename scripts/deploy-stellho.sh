#!/usr/bin/env bash
# Деплой на production (stellho). Запуск с машины, где есть SSH-ключ.
#
#   ./scripts/deploy-stellho.sh
#   SSH_KEY=~/.ssh/custom ./scripts/deploy-stellho.sh
#
set -euo pipefail

HOST="${DEPLOY_HOST:-root@111.88.143.155}"
SSH_KEY="${SSH_KEY:-$HOME/.ssh/id_ed25519_stellho}"
REMOTE_DIR="${DEPLOY_DIR:-/home/ref_check}"
FRONTEND_WWW="${FRONTEND_WWW:-/var/www/fridge-frontend}"

SSH_OPTS=(-i "$SSH_KEY" -o StrictHostKeyChecking=accept-new)

echo "==> Deploy to $HOST ($REMOTE_DIR)"

ssh "${SSH_OPTS[@]}" "$HOST" bash -s <<EOF
set -euo pipefail
cd "$REMOTE_DIR"
git pull

cd fridge-manager
npm install --omit=dev
chmod +x scripts/watchdog-health.sh scripts/setup-autorestart.sh scripts/tune-mongodb-memory.sh 2>/dev/null || true
if command -v docker >/dev/null 2>&1; then
  sudo MONGO_CACHE_GB=1 bash scripts/tune-mongodb-memory.sh || true
fi
bash scripts/setup-autorestart.sh

cd ../fridge-frontend
npm ci
npm run build
rsync -a --delete dist/ "$FRONTEND_WWW/"

echo "DEPLOY_OK"
EOF

echo "==> Updating nginx cache headers"
scp "${SSH_OPTS[@]}" "$(dirname "$0")/nginx-stellref.conf" "$HOST:/etc/nginx/sites-enabled/stellref"
ssh "${SSH_OPTS[@]}" "$HOST" "nginx -t && systemctl reload nginx"

echo "==> Done."
