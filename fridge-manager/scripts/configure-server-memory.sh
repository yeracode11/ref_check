#!/usr/bin/env bash
#
# Настройка RAM для VPS 8 GB: swap + лимит WiredTiger MongoDB.
# Безопасно перезапускает контейнер fridge-mongodb с тем же volume.
#
#   sudo bash scripts/configure-server-memory.sh
#   sudo MONGO_CACHE_GB=2 SWAP_GB=2 bash scripts/configure-server-memory.sh
#
set -euo pipefail

CONTAINER="${MONGO_DOCKER_NAME:-fridge-mongodb}"
IMAGE="${MONGO_DOCKER_IMAGE:-mongo:7.0}"
DATA_DIR="${MONGO_DOCKER_DATA:-/var/lib/fridge-mongodb-docker}"
PORT="${MONGO_PORT:-27017}"
CACHE_GB="${MONGO_CACHE_GB:-2}"
SWAP_GB="${SWAP_GB:-2}"
SWAP_FILE="${SWAP_FILE:-/swapfile}"

if [[ "$(id -u)" -ne 0 ]]; then
  echo "[memory] Запустите: sudo bash $0"
  exit 1
fi

total_mb="$(awk '/MemTotal/ {print int($2/1024)}' /proc/meminfo)"
echo "[memory] RAM total: ${total_mb} MB"

if [[ "$total_mb" -lt 7000 ]]; then
  echo "[memory] WARN: меньше 8 GB — cache MongoDB=${CACHE_GB}G, swap=${SWAP_GB}G"
fi

# --- Swap ---
if swapon --show | grep -q "$SWAP_FILE"; then
  echo "[memory] Swap уже активен: $SWAP_FILE"
elif [[ -f "$SWAP_FILE" ]]; then
  chmod 600 "$SWAP_FILE"
  mkswap "$SWAP_FILE" >/dev/null
  swapon "$SWAP_FILE"
  grep -qF "$SWAP_FILE" /etc/fstab || echo "$SWAP_FILE none swap sw 0 0" >> /etc/fstab
  echo "[memory] Swap включён: $SWAP_FILE"
else
  echo "[memory] Создаём swap ${SWAP_GB}G → $SWAP_FILE"
  fallocate -l "${SWAP_GB}G" "$SWAP_FILE" 2>/dev/null || dd if=/dev/zero of="$SWAP_FILE" bs=1M count=$((SWAP_GB * 1024)) status=progress
  chmod 600 "$SWAP_FILE"
  mkswap "$SWAP_FILE"
  swapon "$SWAP_FILE"
  grep -qF "$SWAP_FILE" /etc/fstab || echo "$SWAP_FILE none swap sw 0 0" >> /etc/fstab
  echo "[memory] Swap OK"
fi

# --- MongoDB cache ---
if ! command -v docker >/dev/null 2>&1; then
  echo "[memory] docker не найден — пропуск MongoDB"
  exit 0
fi

if ! docker ps -a --format '{{.Names}}' | grep -qx "$CONTAINER"; then
  echo "[memory] Контейнер $CONTAINER не найден — пропуск"
  exit 0
fi

current_cache="$(docker inspect "$CONTAINER" --format '{{join .Config.Cmd " "}}' 2>/dev/null | grep -oE 'wiredTigerCacheSizeGB [0-9.]+' | awk '{print $2}' || true)"
if [[ "$current_cache" == "$CACHE_GB" ]]; then
  echo "[memory] MongoDB cache уже ${CACHE_GB} GB"
  exit 0
fi

echo "[memory] MongoDB cache ${current_cache:-?} → ${CACHE_GB} GB (краткий restart контейнера)..."
docker stop "$CONTAINER"
docker rm "$CONTAINER"

docker run -d \
  --name "$CONTAINER" \
  --restart unless-stopped \
  -p "127.0.0.1:${PORT}:27017" \
  -v "${DATA_DIR}:/data/db" \
  "$IMAGE" \
  --wiredTigerCacheSizeGB "$CACHE_GB"

sleep 4
if docker exec "$CONTAINER" mongosh --quiet --eval 'db.runCommand({ping:1}).ok' | grep -q 1; then
  echo "[memory] MongoDB OK — wiredTigerCacheSizeGB=${CACHE_GB}"
else
  echo "[memory] ERROR: MongoDB не отвечает"
  docker logs "$CONTAINER" --tail 20
  exit 1
fi

echo "[memory] free -h:"
free -h
