#!/usr/bin/env bash
#
# Устанавливает ежедневный cron-бэкап MongoDB на сервере (stellho / production).
#
# Использование (на сервере, от root):
#   cd /home/ref_check && git pull
#   sudo bash fridge-manager/scripts/install-daily-backup-cron.sh
#
# Переменные (опционально):
#   PROJECT_DIR     — /home/ref_check/fridge-manager
#   BACKUP_DIR      — /backups
#   CRON_HOUR       — час UTC (по умолчанию 3 → 08:00 Asia/Almaty)
#   CRON_MINUTE     — минута (по умолчанию 30)
#   RETENTION_DAYS  — удалять архивы старше N дней (по умолчанию 30)
#   CRON_USER       — пользователь crontab (по умолчанию root при sudo)
#   MONGO_DOCKER_CONTAINER — fridge-mongodb (если MongoDB в Docker)
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="${PROJECT_DIR:-$(cd "$SCRIPT_DIR/.." && pwd)}"
BACKUP_SCRIPT="$PROJECT_DIR/scripts/mongodb_daily_backup.sh"
ENV_FILE="${ENV_FILE:-$PROJECT_DIR/.env}"
BACKUP_DIR="${BACKUP_DIR:-/backups}"
CRON_HOUR="${CRON_HOUR:-3}"
CRON_MINUTE="${CRON_MINUTE:-30}"
RETENTION_DAYS="${RETENTION_DAYS:-30}"
CRON_USER="${CRON_USER:-${SUDO_USER:-root}}"
MONGO_DOCKER_CONTAINER="${MONGO_DOCKER_CONTAINER:-}"

log() { echo "[install-backup-cron] $*"; }
die() { echo "[install-backup-cron] ERROR: $*" >&2; exit 1; }

[[ -f "$BACKUP_SCRIPT" ]] || die "Не найден скрипт: $BACKUP_SCRIPT"
[[ -f "$ENV_FILE" ]] || die "Не найден .env: $ENV_FILE (задайте ENV_FILE=...)"

detect_mongo_docker() {
  if [[ -n "$MONGO_DOCKER_CONTAINER" ]]; then
    echo "$MONGO_DOCKER_CONTAINER"
    return 0
  fi
  docker ps --format '{{.Names}}' 2>/dev/null | grep -E '^(fridge-mongodb|mongo)$' | head -1 || true
}

check_mongodump() {
  if command -v mongodump >/dev/null 2>&1; then
    log "mongodump на хосте: $(mongodump --version | head -1)"
    return 0
  fi

  local container
  container="$(detect_mongo_docker)"
  if [[ -z "$container" ]]; then
    die "mongodump не найден и контейнер MongoDB не запущен (docker ps | grep fridge-mongodb)"
  fi
  if ! docker exec "$container" mongodump --version >/dev/null 2>&1; then
    die "В контейнере $container нет mongodump"
  fi
  MONGO_DOCKER_CONTAINER="$container"
  log "mongodump через Docker-контейнер: $container"
}

check_mongodump

chmod +x "$BACKUP_SCRIPT"
mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR" 2>/dev/null || true

CRON_ENV="ENV_FILE=${ENV_FILE} BACKUP_DIR=${BACKUP_DIR} RETENTION_DAYS=${RETENTION_DAYS}"
if [[ -n "$MONGO_DOCKER_CONTAINER" ]]; then
  CRON_ENV="$CRON_ENV MONGO_DOCKER_CONTAINER=${MONGO_DOCKER_CONTAINER}"
fi
CRON_LINE="${CRON_MINUTE} ${CRON_HOUR} * * * ${CRON_ENV} ${BACKUP_SCRIPT} >> ${BACKUP_DIR}/cron.log 2>&1"
CRON_MARKER="# fridge-manager daily mongodb backup"

log "PROJECT_DIR=$PROJECT_DIR"
log "BACKUP_DIR=$BACKUP_DIR"
log "RETENTION_DAYS=$RETENTION_DAYS"
log "CRON_USER=$CRON_USER"
log "Расписание (UTC): ${CRON_MINUTE} ${CRON_HOUR} * * * (= $(TZ=Asia/Almaty date -d "${CRON_HOUR}:${CRON_MINUTE} UTC" '+%H:%M %Z' 2>/dev/null || echo 'Almaty +5'))"
log "Cron-строка:"
log "  $CRON_LINE"

install_for_user() {
  local user="$1"
  local tmp
  tmp="$(mktemp)"
  crontab -u "$user" -l 2>/dev/null | grep -vF "$BACKUP_SCRIPT" | grep -vF "$CRON_MARKER" >"$tmp" || true
  {
    cat "$tmp"
    echo "$CRON_MARKER"
    echo "$CRON_LINE"
  } | crontab -u "$user" -
  rm -f "$tmp"
}

if [[ "$(id -u)" -eq 0 ]]; then
  install_for_user "$CRON_USER"
else
  die "Запустите от root: sudo bash $0"
fi

log "Cron установлен:"
crontab -u "$CRON_USER" -l 2>/dev/null | grep -A1 "$CRON_MARKER" || true

log ""
log "Пробный запуск бэкапа..."
RUN_ENV=(ENV_FILE="$ENV_FILE" BACKUP_DIR="$BACKUP_DIR" RETENTION_DAYS="$RETENTION_DAYS")
if [[ -n "$MONGO_DOCKER_CONTAINER" ]]; then
  RUN_ENV+=(MONGO_DOCKER_CONTAINER="$MONGO_DOCKER_CONTAINER")
fi
env "${RUN_ENV[@]}" bash "$BACKUP_SCRIPT"

log ""
log "Готово."
log "  Архивы: ${BACKUP_DIR}/fridge_manager_*.gz"
log "  Лог:    ${BACKUP_DIR}/backup.log"
log "  Cron:   ${BACKUP_DIR}/cron.log"
