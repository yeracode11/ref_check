#!/usr/bin/env bash
#
# Ежедневный бэкап MongoDB (вся база fridge_manager: users, fridges, checkins, cities, counters …).
#
# Переменные окружения (опционально):
#   MONGODB_URI     — строка подключения (если не задана, читается из ENV_FILE)
#   ENV_FILE        — путь к .env с MONGODB_URI (по умолчанию: ../.env относительно скрипта)
#   BACKUP_DIR      — каталог бэкапов (по умолчанию: /backups)
#   RETENTION_COUNT — сколько последних архивов хранить (по умолчанию: 30)
#   LOG_FILE        — лог (по умолчанию: BACKUP_DIR/backup.log)
#
# Требования: mongodump в PATH (пакет mongodb-database-tools).
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEFAULT_ENV="${SCRIPT_DIR}/../.env"

ENV_FILE="${ENV_FILE:-$DEFAULT_ENV}"
BACKUP_DIR="${BACKUP_DIR:-/backups}"
RETENTION_COUNT="${RETENTION_COUNT:-30}"
LOG_FILE="${LOG_FILE:-$BACKUP_DIR/backup.log}"
ARCHIVE_PREFIX="fridge_manager_"

log() {
  echo "[$(date -u '+%Y-%m-%dT%H:%M:%SZ')] $*" | tee -a "$LOG_FILE"
}

log_error() {
  echo "[$(date -u '+%Y-%m-%dT%H:%M:%SZ')] ERROR: $*" | tee -a "$LOG_FILE" >&2
}

cleanup_old_backups() {
  # ls -1t: сначала новые; оставляем RETENTION_COUNT последних, остальное удаляем
  local i=0
  local deleted=0
  while IFS= read -r f; do
    [[ -z "$f" || ! -f "$f" ]] && continue
    ((i++)) || true
    if (( i > RETENTION_COUNT )); then
      log "  удалить: $f"
      rm -f "$f"
      ((deleted++)) || true
    fi
  done < <(ls -1t "$BACKUP_DIR"/${ARCHIVE_PREFIX}*.gz 2>/dev/null || true)
  if (( deleted > 0 )); then
    log "Удалено старых архивов: $deleted (храним последние $RETENTION_COUNT)"
  elif (( i > 0 )); then
    log "Архивов: $i (лимит $RETENTION_COUNT) — удаление не требуется"
  else
    log "Архивов пока нет (кроме только что созданного)"
  fi
}

on_fail() {
  local exit_code=$?
  log_error "Скрипт завершился с кодом $exit_code (строка $1)"
  exit "$exit_code"
}
trap 'on_fail $LINENO' ERR

if ! command -v mongodump >/dev/null 2>&1; then
  log_error "mongodump не найден. Установите: apt install mongodb-database-tools (или скачайте с сайта MongoDB)."
  exit 127
fi

mkdir -p "$BACKUP_DIR"
touch "$LOG_FILE" || {
  log_error "Не удалось писать в LOG_FILE=$LOG_FILE"
  exit 1
}

if [[ -z "${MONGODB_URI:-}" ]]; then
  if [[ ! -f "$ENV_FILE" ]]; then
    log_error "Нет MONGODB_URI и файл не найден: $ENV_FILE"
    log_error "Задайте MONGODB_URI или ENV_FILE=/полный/путь/.env"
    exit 1
  fi
  # Берём последнюю строку MONGODB_URI= (без exec source — безопаснее для $ в пароле)
  line="$(grep -E '^[[:space:]]*MONGODB_URI=' "$ENV_FILE" | tail -n1 || true)"
  if [[ -z "$line" ]]; then
    log_error "В $ENV_FILE не найдена строка MONGODB_URI="
    exit 1
  fi
  MONGODB_URI="${line#MONGODB_URI=}"
  MONGODB_URI="${MONGODB_URI#\"}"
  MONGODB_URI="${MONGODB_URI%\"}"
  MONGODB_URI="${MONGODB_URI#\'}"
  MONGODB_URI="${MONGODB_URI%\'}"
fi

if [[ -z "$MONGODB_URI" ]]; then
  log_error "MONGODB_URI пустой после чтения конфигурации"
  exit 1
fi

STAMP="$(date -u '+%Y-%m-%d_%H%M%S')"
ARCHIVE_PATH="${BACKUP_DIR}/${ARCHIVE_PREFIX}${STAMP}.gz"

log "=== Начало бэкапа ==="
log "Архив: $ARCHIVE_PATH"
SAFE_URI="$(printf '%s' "$MONGODB_URI" | sed -E 's|(//)[^/@]+@|\1***@|')"
log "URI (маскировано): $SAFE_URI"

if mongodump --uri="$MONGODB_URI" --gzip --archive="$ARCHIVE_PATH" >>"$LOG_FILE" 2>&1; then
  log "mongodump выполнен"
else
  log_error "mongodump завершился с ошибкой (см. сообщения выше в этом логе)"
  rm -f "$ARCHIVE_PATH"
  exit 1
fi

if [[ ! -s "$ARCHIVE_PATH" ]]; then
  log_error "Архив пустой или не создан: $ARCHIVE_PATH"
  rm -f "$ARCHIVE_PATH"
  exit 1
fi

SIZE_H="$(du -h "$ARCHIVE_PATH" | cut -f1)"
log "Готово, размер: $SIZE_H"

cleanup_old_backups

log "=== Бэкап успешно завершён ==="
exit 0
