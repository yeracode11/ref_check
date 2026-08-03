#!/usr/bin/env bash
#
# Устанавливает ежедневный cron-бэкап MongoDB на сервере (stellho / production).
#
# Использование (на сервере, от root или пользователя с правом cron):
#   sudo bash scripts/install-daily-backup-cron.sh
#
# Переменные (опционально):
#   PROJECT_DIR     — /home/ref_check/fridge-manager
#   BACKUP_DIR      — /backups
#   CRON_HOUR       — час UTC (по умолчанию 3 → 08:00 Asia/Almaty)
#   CRON_MINUTE     — минута (по умолчанию 30)
#   RETENTION_DAYS  — удалять архивы старше N дней (по умолчанию 30)
#   CRON_USER       — пользователь crontab (по умолчанию: whoami или root при sudo)
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
CRON_USER="${CRON_USER:-${SUDO_USER:-$(whoami)}}"

log() { echo "[install-backup-cron] $*"; }
die() { echo "[install-backup-cron] ERROR: $*" >&2; exit 1; }

[[ -f "$BACKUP_SCRIPT" ]] || die "Не найден скрипт: $BACKUP_SCRIPT"
[[ -f "$ENV_FILE" ]] || die "Не найден .env: $ENV_FILE (задайте ENV_FILE=...)"

if ! command -v mongodump >/dev/null 2>&1; then
  log "mongodump не найден — пробуем установить mongodb-database-tools..."
  if command -v apt-get >/dev/null 2>&1; then
    apt-get update -qq
    apt-get install -y mongodb-database-tools
  else
    die "Установите mongodump вручную: apt install mongodb-database-tools"
  fi
fi

chmod +x "$BACKUP_SCRIPT"
mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR" 2>/dev/null || true

CRON_LINE="${CRON_MINUTE} ${CRON_HOUR} * * * ENV_FILE=${ENV_FILE} BACKUP_DIR=${BACKUP_DIR} RETENTION_DAYS=${RETENTION_DAYS} ${BACKUP_SCRIPT} >> ${BACKUP_DIR}/cron.log 2>&1"
CRON_MARKER="# fridge-manager daily mongodb backup"

log "PROJECT_DIR=$PROJECT_DIR"
log "BACKUP_DIR=$BACKUP_DIR"
log "RETENTION_DAYS=$RETENTION_DAYS"
log "CRON_USER=$CRON_USER"
log "Расписание (UTC): ${CRON_MINUTE} ${CRON_HOUR} * * *"
log "Cron-строка:"
log "  $CRON_LINE"

install_for_user() {
  local user="$1"
  local tmp
  tmp="$(mktemp)"
  if crontab -u "$user" -l 2>/dev/null | grep -F "$BACKUP_SCRIPT" >/dev/null; then
    crontab -u "$user" -l 2>/dev/null | grep -vF "$BACKUP_SCRIPT" | grep -vF "$CRON_MARKER" >"$tmp" || true
  else
    crontab -u "$user" -l 2>/dev/null >"$tmp" || true
  fi
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
  if crontab -l 2>/dev/null | grep -F "$BACKUP_SCRIPT" >/dev/null; then
    tmp="$(mktemp)"
    crontab -l 2>/dev/null | grep -vF "$BACKUP_SCRIPT" | grep -vF "$CRON_MARKER" >"$tmp" || true
    { cat "$tmp"; echo "$CRON_MARKER"; echo "$CRON_LINE"; } | crontab -
    rm -f "$tmp"
  else
    { crontab -l 2>/dev/null || true; echo "$CRON_MARKER"; echo "$CRON_LINE"; } | crontab -
  fi
fi

log "Cron установлен. Текущий crontab:"
crontab -u "$CRON_USER" -l 2>/dev/null | grep -A1 "$CRON_MARKER" || crontab -l 2>/dev/null | grep -A1 "$CRON_MARKER" || true

log ""
log "Пробный запуск бэкапа..."
ENV_FILE="$ENV_FILE" BACKUP_DIR="$BACKUP_DIR" RETENTION_DAYS="$RETENTION_DAYS" bash "$BACKUP_SCRIPT"

log ""
log "Готово. Архивы: ${BACKUP_DIR}/fridge_manager_*.gz"
log "Лог: ${BACKUP_DIR}/backup.log и ${BACKUP_DIR}/cron.log"
