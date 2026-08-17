#!/usr/bin/env bash
# Проверка /api/health; при сбое — MongoDB (docker) и PM2 fridge-manager.
# Cron: */2 * * * * /home/ref_check/fridge-manager/scripts/watchdog-health.sh
set -euo pipefail

APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PORT="${PORT:-4000}"
HEALTH_URL="http://127.0.0.1:${PORT}/api/health"
LOG="${WATCHDOG_LOG:-/var/log/fridge-watchdog.log}"
MONGO_CONTAINER="${MONGO_DOCKER_NAME:-fridge-mongodb}"
LOCK="/tmp/fridge-watchdog.lock"

log() {
  echo "[$(date -Iseconds)] $*" >>"$LOG"
}

if ! mkdir "$LOCK" 2>/dev/null; then
  exit 0
fi
trap 'rmdir "$LOCK" 2>/dev/null || true' EXIT

response="$(curl -sf --max-time 8 "$HEALTH_URL" 2>/dev/null || true)"
if echo "$response" | grep -q '"mongoReady":true'; then
  exit 0
fi

log "UNHEALTHY response=${response:-empty}"

if command -v docker >/dev/null 2>&1; then
  if docker ps -a --format '{{.Names}}' | grep -qx "$MONGO_CONTAINER"; then
    if ! docker exec "$MONGO_CONTAINER" mongosh --quiet --eval 'db.runCommand({ping:1}).ok' 2>/dev/null | grep -q 1; then
      log "Restarting MongoDB container $MONGO_CONTAINER"
      docker restart "$MONGO_CONTAINER" >>"$LOG" 2>&1 || true
      sleep 12
    fi
  fi
fi

if command -v pm2 >/dev/null 2>&1; then
  log "Restarting PM2 fridge-manager"
  cd "$APP_DIR"
  if pm2 describe fridge-manager >/dev/null 2>&1; then
    pm2 restart fridge-manager --update-env >>"$LOG" 2>&1 || true
  else
    pm2 start ecosystem.config.js >>"$LOG" 2>&1 || true
  fi
  pm2 save >>"$LOG" 2>&1 || true
  sleep 5
fi

response2="$(curl -sf --max-time 8 "$HEALTH_URL" 2>/dev/null || true)"
if echo "$response2" | grep -q '"mongoReady":true'; then
  log "RECOVERED OK"
else
  log "STILL UNHEALTHY after restart response=${response2:-empty}"
fi
