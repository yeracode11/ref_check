#!/usr/bin/env bash
#
# Восстановление после OOM-killer (mongod съел ~3 GB RAM на VPS 4 GB).
# 1) Ставит/запускает mongod с малым wiredTiger cache
# 2) Восстанавливает последний (или указанный) архив из /backups
# 3) Подсказывает перезапуск PM2
#
#   sudo MONGO_CACHE_GB=1 bash scripts/recover-mongodb-after-oom.sh
#   sudo RESTORE_ARCHIVE=/backups/fridge_manager_2026-07-27_031501.gz bash scripts/recover-mongodb-after-oom.sh
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${ENV_FILE:-$SCRIPT_DIR/../.env}"
BACKUP_DIR="${BACKUP_DIR:-/backups}"
export MONGO_CACHE_GB="${MONGO_CACHE_GB:-1}"

if [[ "$(id -u)" -ne 0 ]]; then
  echo "[recover] Запустите: sudo bash scripts/recover-mongodb-after-oom.sh"
  exit 1
fi

read_uri_from_env() {
  if [[ ! -f "$ENV_FILE" ]]; then
    echo "[recover] ERROR: нет $ENV_FILE"
    exit 1
  fi
  local line
  line="$(grep -E '^[[:space:]]*MONGODB_URI=' "$ENV_FILE" | tail -n1 || true)"
  if [[ -z "$line" ]]; then
    echo "[recover] ERROR: MONGODB_URI не найден в $ENV_FILE"
    exit 1
  fi
  MONGODB_URI="${line#MONGODB_URI=}"
  MONGODB_URI="${MONGODB_URI#\"}"; MONGODB_URI="${MONGODB_URI%\"}"
  MONGODB_URI="${MONGODB_URI#\'}"; MONGODB_URI="${MONGODB_URI%\'}"
}

pick_archive() {
  if [[ -n "${RESTORE_ARCHIVE:-}" ]]; then
    if [[ ! -f "$RESTORE_ARCHIVE" ]]; then
      echo "[recover] ERROR: файл не найден: $RESTORE_ARCHIVE"
      exit 1
    fi
    echo "$RESTORE_ARCHIVE"
    return
  fi
  local latest
  latest="$(ls -1t "$BACKUP_DIR"/fridge_manager_*.gz 2>/dev/null | head -1 || true)"
  if [[ -z "$latest" ]]; then
    echo "[recover] ERROR: нет архивов $BACKUP_DIR/fridge_manager_*.gz"
    exit 1
  fi
  echo "$latest"
}

echo "[recover] === MongoDB recovery (OOM-safe cache ${MONGO_CACHE_GB} GB) ==="
echo "[recover] Причина простоя: ядро убило mongod (Out of memory). См. dmesg."

bash "$SCRIPT_DIR/install-mongodb-ubuntu.sh"

read_uri_from_env
ARCHIVE="$(pick_archive)"
echo "[recover] Восстановление из: $ARCHIVE"
SAFE_URI="$(printf '%s' "$MONGODB_URI" | sed -E 's|(//)[^/@]+@|\1***@|')"
echo "[recover] URI: $SAFE_URI"

if ! command -v mongorestore >/dev/null 2>&1; then
  echo "[recover] ERROR: mongorestore не найден (mongodb-database-tools)"
  exit 127
fi

# --drop: заменить текущее содержимое БД из архива (после OOM каталог может быть битым/пустым)
if mongorestore --gzip --archive="$ARCHIVE" --uri="$MONGODB_URI" --drop; then
  echo "[recover] mongorestore OK"
else
  echo "[recover] Пробуем restore без auth (локально), затем снова с URI..."
  if mongorestore --gzip --archive="$ARCHIVE" --uri="mongodb://127.0.0.1:27017" --drop; then
    echo "[recover] mongorestore (no auth) OK"
  else
    echo "[recover] ERROR: mongorestore failed"
    exit 1
  fi
fi

if systemctl is-active --quiet mongod; then
  echo "[recover] mongod: active"
else
  systemctl start mongod
fi

echo ""
echo "[recover] Готово. Перезапустите API:"
echo "  cd $SCRIPT_DIR/.. && bash scripts/restart-production.sh"
echo ""
echo "Чтобы снова не убило OOM на 4 GB VPS:"
echo "  - держите MONGO_CACHE_GB=1 (или 0.75) в /etc/mongod.conf"
echo "  - опционально swap 2G: fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile"
echo "  - долгосрочно: MongoDB Atlas или VPS 8 GB RAM"
