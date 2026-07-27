#!/usr/bin/env bash
# Перезапуск бэкенда на сервере (stellref.kz)
set -euo pipefail

APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$APP_DIR"

echo "[restart] Directory: $APP_DIR"

if [[ -x "$APP_DIR/scripts/ensure-mongodb.sh" ]]; then
  bash "$APP_DIR/scripts/ensure-mongodb.sh" || exit 1
else
  echo "[restart] WARNING: scripts/ensure-mongodb.sh not found — проверьте, что mongod запущен"
fi

if [[ -f "$APP_DIR/scripts/sync-mongodb-user-from-env.js" ]]; then
  if ! node "$APP_DIR/scripts/sync-mongodb-user-from-env.js" 2>/dev/null; then
    echo "[restart] NOTE: sync MongoDB user skipped or failed (run: node scripts/sync-mongodb-user-from-env.js)"
  fi
fi

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
HEALTH="$(curl -sf "http://127.0.0.1:${PORT:-4000}/health" || true)"
echo "$HEALTH" | head -c 400
if echo "$HEALTH" | grep -q '"mongoReady":true'; then
  echo ""
  echo "[restart] OK — backend and MongoDB are up"
else
  echo ""
  echo "[restart] ERROR: backend up but MongoDB not ready (or no response)"
  echo "[restart] Run: bash scripts/ensure-mongodb.sh && pm2 restart fridge-manager"
  pm2 logs fridge-manager --lines 30 --nostream || true
  exit 1
fi
