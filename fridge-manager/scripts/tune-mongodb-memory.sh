#!/usr/bin/env bash
# Снизить RAM MongoDB (WiredTiger cache) на VPS 8 GB.
# Без этого Mongo может занять ~2 GB cache + рабочая память → OOM и «зависание» всего сервера.
#
#   sudo MONGO_CACHE_GB=1 bash scripts/tune-mongodb-memory.sh
#
set -euo pipefail

CONTAINER="${MONGO_DOCKER_NAME:-fridge-mongodb}"
IMAGE="${MONGO_DOCKER_IMAGE:-mongo:7.0}"
DATA_DIR="${MONGO_DOCKER_DATA:-/var/lib/fridge-mongodb-docker}"
PORT="${MONGO_PORT:-27017}"
TARGET_GB="${MONGO_CACHE_GB:-1}"

if [[ "$(id -u)" -ne 0 ]]; then
  echo "[mongo-tune] Run: sudo MONGO_CACHE_GB=$TARGET_GB bash scripts/tune-mongodb-memory.sh"
  exit 1
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "[mongo-tune] docker not found"
  exit 1
fi

if ! docker ps -a --format '{{.Names}}' | grep -qx "$CONTAINER"; then
  echo "[mongo-tune] Container $CONTAINER not found — skip"
  exit 0
fi

current_cmd="$(docker inspect "$CONTAINER" --format '{{join .Config.Cmd " "}}' 2>/dev/null || true)"
if echo "$current_cmd" | grep -q "wiredTigerCacheSizeGB $TARGET_GB"; then
  echo "[mongo-tune] Already wiredTigerCacheSizeGB=$TARGET_GB — OK"
  exit 0
fi

echo "[mongo-tune] Recreating $CONTAINER with wiredTigerCacheSizeGB=$TARGET_GB (data: $DATA_DIR)"
pm2 stop fridge-manager 2>/dev/null || true

docker stop "$CONTAINER" >/dev/null
docker rm "$CONTAINER" >/dev/null

docker run -d \
  --name "$CONTAINER" \
  --restart unless-stopped \
  -p "127.0.0.1:${PORT}:27017" \
  -v "${DATA_DIR}:/data/db" \
  "$IMAGE" \
  --wiredTigerCacheSizeGB "$TARGET_GB"

for i in $(seq 1 30); do
  if docker exec "$CONTAINER" mongosh --quiet --eval 'db.runCommand({ping:1}).ok' 2>/dev/null | grep -q 1; then
    echo "[mongo-tune] MongoDB ready"
    break
  fi
  sleep 1
  if [[ "$i" -eq 30 ]]; then
    echo "[mongo-tune] ERROR: MongoDB did not start"
    docker logs "$CONTAINER" --tail 20
    exit 1
  fi
done

pm2 start fridge-manager 2>/dev/null || pm2 restart fridge-manager --update-env || true
pm2 save 2>/dev/null || true

echo "[mongo-tune] Done — cache ${TARGET_GB}GB"
