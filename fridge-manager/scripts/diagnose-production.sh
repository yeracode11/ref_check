#!/usr/bin/env bash
# Быстрая диагностика 502 / CORS на сервере (stellref.kz)
set -euo pipefail

APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PORT="${PORT:-4000}"

echo "=== fridge-manager diagnose ==="
echo "Directory: $APP_DIR"
echo ""

echo "--- PM2 ---"
pm2 describe fridge-manager 2>/dev/null | grep -E 'status|uptime|restarts|script path|exec cwd' || echo "PM2 process fridge-manager not found"
echo ""

echo "--- Code (CORS fix) ---"
if grep -q 'createCorsOriginChecker' "$APP_DIR/server.js" 2>/dev/null; then
  echo "server.js: OK (createCorsOriginChecker)"
else
  echo "server.js: OUTDATED — run: cd $APP_DIR && git pull && bash scripts/restart-production.sh"
fi
if [[ -f "$APP_DIR/lib/corsOrigins.js" ]]; then
  echo "lib/corsOrigins.js: present"
else
  echo "lib/corsOrigins.js: MISSING — git pull required"
fi
echo ""

echo "--- .env CORS ---"
if [[ -f "$APP_DIR/.env" ]]; then
  grep -E '^CORS_ORIGIN=' "$APP_DIR/.env" || echo "CORS_ORIGIN not set (all origins allowed, no credentials)"
else
  echo ".env not found"
fi
echo ""

echo "--- MongoDB (127.0.0.1:27017) ---"
if [[ -x "$APP_DIR/scripts/ensure-mongodb.sh" ]]; then
  bash "$APP_DIR/scripts/ensure-mongodb.sh" || true
else
  (echo >/dev/tcp/127.0.0.1/27017) 2>/dev/null && echo "port 27017: open" || echo "port 27017: CLOSED — sudo systemctl start mongod"
fi
echo ""

echo "--- Backend health (localhost) ---"
if curl -sf "http://127.0.0.1:${PORT}/health" | head -c 400; then
  echo ""
else
  echo "FAILED — nginx will return 502 for /api/*"
  echo "Recent PM2 errors:"
  pm2 logs fridge-manager --lines 20 --nostream 2>/dev/null || true
fi
echo ""

echo "--- Memory ---"
free -h 2>/dev/null || vm_stat 2>/dev/null | head -5 || true
echo ""

echo "--- Nginx (if installed) ---"
if command -v nginx >/dev/null 2>&1; then
  sudo tail -n 15 /var/log/nginx/error.log 2>/dev/null || tail -n 15 /var/log/nginx/error.log 2>/dev/null || echo "cannot read nginx error.log"
else
  echo "nginx not in PATH"
fi
