#!/usr/bin/env bash
#
# MongoDB в Docker (если apt: libssl1.1 / focal / broken packages).
# Слушает только 127.0.0.1:27017, cache 1 GB, autorestart.
#
#   sudo MONGO_CACHE_GB=1 bash scripts/install-mongodb-docker.sh
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${ENV_FILE:-$SCRIPT_DIR/../.env}"
CONTAINER="${MONGO_DOCKER_NAME:-fridge-mongodb}"
IMAGE="${MONGO_DOCKER_IMAGE:-mongo:7.0}"
DATA_DIR="${MONGO_DOCKER_DATA:-/var/lib/fridge-mongodb-docker}"
CACHE_GB="${MONGO_CACHE_GB:-1}"
PORT="${MONGO_PORT:-27017}"

if [[ "$(id -u)" -ne 0 ]]; then
  echo "[mongo-docker] sudo bash scripts/install-mongodb-docker.sh"
  exit 1
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "[mongo-docker] Installing docker.io..."
  apt-get update -qq
  apt-get install -y docker.io
  systemctl enable --now docker
fi

mkdir -p "$DATA_DIR"

if docker ps -a --format '{{.Names}}' | grep -qx "$CONTAINER"; then
  echo "[mongo-docker] Removing old container $CONTAINER (data in $DATA_DIR)"
  docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
fi

# Без MONGO_INITDB — восстановление через mongorestore; auth настроим после restore при необходимости
echo "[mongo-docker] Starting $IMAGE on 127.0.0.1:${PORT}..."
docker run -d \
  --name "$CONTAINER" \
  --restart unless-stopped \
  -p "127.0.0.1:${PORT}:27017" \
  -v "${DATA_DIR}:/data/db" \
  "$IMAGE" \
  --wiredTigerCacheSizeGB "$CACHE_GB"

sleep 3
if ! docker exec "$CONTAINER" mongosh --quiet --eval 'db.runCommand({ping:1}).ok' | grep -q 1; then
  echo "[mongo-docker] ERROR: container not healthy"
  docker logs "$CONTAINER" --tail 30
  exit 1
fi

echo "[mongo-docker] OK — container $CONTAINER"
echo "[mongo-docker] Restore: mongorestore --gzip --archive=/backups/fridge_manager_....gz --uri=\"mongodb://127.0.0.1:27017\" --drop"
echo "[mongo-docker] Or: bash scripts/recover-mongodb-after-oom.sh (after git pull)"

if [[ -f "$ENV_FILE" ]]; then
  line="$(grep -E '^[[:space:]]*MONGODB_URI=' "$ENV_FILE" | tail -n1 || true)"
  uri="${line#MONGODB_URI=}"
  if [[ "$uri" =~ mongodb://([^:/]+):([^@]+)@ ]]; then
    echo "[mongo-docker] После mongorestore создайте пользователя из .env или запустите install-mongodb-ubuntu user block вручную через mongosh"
  fi
fi
