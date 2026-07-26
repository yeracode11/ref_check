#!/usr/bin/env bash
# Перезапуск бэкенда на сервере (stellref.kz)
set -euo pipefail

APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$APP_DIR"

echo "[restart] Directory: $APP_DIR"

if [[ ! -f "$APP_DIR/server.js" ]]; then
  echo "[restart] ERROR: server.js not found in $APP_DIR"
  exit 1
fi

if [[ ! -f "$APP_DIR/.env" ]]; then
  echo "[restart] WARNING: .env not found — проверьте MONGODB_URI и JWT_SECRET"
fi

echo "[restart] Installing dependencies..."
npm install --omit=dev

echo "[restart] Syntax check..."
node --check server.js

if ! grep -q 'createCorsOriginChecker' "$APP_DIR/server.js"; then
  echo "[restart] ERROR: server.js без lib/corsOrigins — выполните git pull в репозитории"
  exit 1
fi
if [[ ! -f "$APP_DIR/lib/corsOrigins.js" ]]; then
  echo "[restart] ERROR: отсутствует lib/corsOrigins.js — выполните git pull"
  exit 1
fi

if pm2 describe fridge-manager >/dev/null 2>&1; then
  echo "[restart] Restarting PM2 process fridge-manager..."
  pm2 restart ecosystem.config.js --update-env
else
  echo "[restart] Starting PM2 process fridge-manager..."
  pm2 start ecosystem.config.js
fi

pm2 save
sleep 2

echo "[restart] Health check:"
curl -sf "http://127.0.0.1:${PORT:-4000}/health" | head -c 300 || {
  echo "[restart] ERROR: backend did not respond on port ${PORT:-4000}"
  echo "[restart] PM2 logs:"
  pm2 logs fridge-manager --lines 30 --nostream || true
  exit 1
}

echo ""
echo "[restart] OK — backend is up"
