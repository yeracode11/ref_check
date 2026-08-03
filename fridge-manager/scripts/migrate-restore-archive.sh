#!/usr/bin/env bash
#
# Восстановление архива MongoDB на новом сервере (native mongod или Docker).
#
#   mkdir -p /backups
#   # scp архив со старого сервера в /backups/
#   bash scripts/migrate-restore-archive.sh /backups/fridge_manager_2026-08-03.gz
#
set -euo pipefail

ARCHIVE="${1:-}"
if [[ -z "$ARCHIVE" || ! -f "$ARCHIVE" ]]; then
  echo "Usage: bash scripts/migrate-restore-archive.sh /backups/fridge_manager_YYYY-MM-DD.gz"
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${ENV_FILE:-$SCRIPT_DIR/../.env}"

if [[ -f "$ENV_FILE" ]]; then
  # shellcheck disable=SC1090
  set -a
  source "$ENV_FILE" 2>/dev/null || true
  set +a
fi

URI="${MONGODB_URI:-mongodb://127.0.0.1:27017}"
# mongorestore для --drop лучше без auth до создания пользователя
RESTORE_URI="mongodb://127.0.0.1:27017"

echo "[migrate-restore] Archive: $ARCHIVE"

if command -v mongorestore >/dev/null 2>&1; then
  mongorestore --gzip --archive="$ARCHIVE" --uri="$RESTORE_URI" --drop
elif docker ps --format '{{.Names}}' 2>/dev/null | grep -qxE 'fridge-mongodb|mongo'; then
  CONTAINER="$(docker ps --format '{{.Names}}' | grep -E '^(fridge-mongodb|mongo)$' | head -1)"
  echo "[migrate-restore] Using docker exec in $CONTAINER"
  docker cp "$ARCHIVE" "$CONTAINER:/tmp/restore.gz"
  docker exec "$CONTAINER" mongorestore --gzip --archive=/tmp/restore.gz --uri="$RESTORE_URI" --drop
  docker exec "$CONTAINER" rm -f /tmp/restore.gz
else
  echo "[migrate-restore] mongorestore not found. Install MongoDB tools or Docker mongo image."
  echo "  sudo bash scripts/install-mongodb-ubuntu.sh"
  echo "  # or: sudo bash scripts/install-mongodb-docker.sh"
  exit 1
fi

if [[ -f "$SCRIPT_DIR/sync-mongodb-user-from-env.js" ]] && [[ -f "$ENV_FILE" ]]; then
  echo "[migrate-restore] Sync MongoDB user from .env..."
  node "$SCRIPT_DIR/sync-mongodb-user-from-env.js" || true
fi

echo "[migrate-restore] OK. Check: curl -s http://127.0.0.1:4000/health"
