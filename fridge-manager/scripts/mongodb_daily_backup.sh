#!/usr/bin/env bash
#
# Ежедневный бэкап MongoDB (вся база fridge_manager: users, fridges, checkins, cities, counters …).
#
# Переменные окружения (опционально):
#   MONGODB_URI     — строка подключения (если не задана, читается из ENV_FILE)
#   ENV_FILE        — путь к .env с MONGODB_URI (по умолчанию: ../.env относительно скрипта)
#   BACKUP_DIR      — каталог бэкапов (по умолчанию: /backups)
#   RETENTION_DAYS  — удалять архивы старше N дней (по умолчанию: 30)
#   RETENTION_COUNT — доп. лимит: хранить не больше N последних (0 = только по дням)
#   LOG_FILE        — лог (по умолчанию: BACKUP_DIR/backup.log)
#   MONGO_DOCKER_CONTAINER — имя контейнера (по умолчанию: fridge-mongodb или mongo)
#
# mongodump: на хосте или внутри Docker-контейнера MongoDB (mongo:7.0 уже содержит mongodump).
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEFAULT_ENV="${SCRIPT_DIR}/../.env"

ENV_FILE="${ENV_FILE:-$DEFAULT_ENV}"
BACKUP_DIR="${BACKUP_DIR:-/backups}"
RETENTION_DAYS="${RETENTION_DAYS:-30}"
RETENTION_COUNT="${RETENTION_COUNT:-0}"
LOG_FILE="${LOG_FILE:-$BACKUP_DIR/backup.log}"
ARCHIVE_PREFIX="fridge_manager_"
MONGO_DOCKER_CONTAINER="${MONGO_DOCKER_CONTAINER:-}"
MONGODUMP_MODE=""

mkdir -p "$BACKUP_DIR"
touch "$LOG_FILE" 2>/dev/null || true

resolve_docker_mongo_container() {
  if [[ -n "$MONGO_DOCKER_CONTAINER" ]]; then
    if docker ps --format '{{.Names}}' 2>/dev/null | grep -qx "$MONGO_DOCKER_CONTAINER"; then
      echo "$MONGO_DOCKER_CONTAINER"
      return 0
    fi
    return 1
  fi
  docker ps --format '{{.Names}}' 2>/dev/null | grep -E '^(fridge-mongodb|mongo)$' | head -1
}

detect_mongodump_mode() {
  if command -v mongodump >/dev/null 2>&1; then
    MONGODUMP_MODE="host"
    return 0
  fi
  if ! command -v docker >/dev/null 2>&1; then
    return 1
  fi
  local container
  container="$(resolve_docker_mongo_container || true)"
  if [[ -n "$container" ]] && docker exec "$container" mongodump --version >/dev/null 2>&1; then
    MONGO_DOCKER_CONTAINER="$container"
    MONGODUMP_MODE="docker"
    return 0
  fi
  return 1
}

run_mongodump() {
  local archive_path="$1"
  local uri="$2"
  if [[ "$MONGODUMP_MODE" == "host" ]]; then
    mongodump --uri="$uri" --gzip --archive="$archive_path"
  elif [[ "$MONGODUMP_MODE" == "docker" ]]; then
    docker exec "$MONGO_DOCKER_CONTAINER" mongodump --uri="$uri" --gzip --archive=- >"$archive_path"
  else
    return 127
  fi
}

log() {
  echo "[$(date -u '+%Y-%m-%dT%H:%M:%SZ')] $*" | tee -a "$LOG_FILE"
}

log_error() {
  echo "[$(date -u '+%Y-%m-%dT%H:%M:%SZ')] ERROR: $*" | tee -a "$LOG_FILE" >&2
}

cleanup_old_backups() {
  local deleted=0
  local remaining=0

  if [[ "$RETENTION_DAYS" =~ ^[0-9]+$ ]] && (( RETENTION_DAYS > 0 )); then
    while IFS= read -r f; do
      [[ -z "$f" || ! -f "$f" ]] && continue
      log "  удалить (старше ${RETENTION_DAYS} дн.): $f"
      rm -f "$f"
      ((deleted++)) || true
    done < <(find "$BACKUP_DIR" -maxdepth 1 -type f -name "${ARCHIVE_PREFIX}*.gz" -mtime +"$RETENTION_DAYS" -print 2>/dev/null || true)
  fi

  if [[ "$RETENTION_COUNT" =~ ^[0-9]+$ ]] && (( RETENTION_COUNT > 0 )); then
    local i=0
    while IFS= read -r f; do
      [[ -z "$f" || ! -f "$f" ]] && continue
      ((i++)) || true
      if (( i > RETENTION_COUNT )); then
        log "  удалить (лимит $RETENTION_COUNT): $f"
        rm -f "$f"
        ((deleted++)) || true
      fi
    done < <(ls -1t "$BACKUP_DIR"/${ARCHIVE_PREFIX}*.gz 2>/dev/null || true)
  fi

  remaining="$(find "$BACKUP_DIR" -maxdepth 1 -type f -name "${ARCHIVE_PREFIX}*.gz" 2>/dev/null | wc -l | tr -d ' ')"
  if (( deleted > 0 )); then
    log "Удалено старых архивов: $deleted (осталось: $remaining, храним ≤ ${RETENTION_DAYS} дн.)"
  elif (( remaining > 0 )); then
    log "Архивов: $remaining — удаление не требуется (лимит ${RETENTION_DAYS} дн.)"
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

if ! detect_mongodump_mode; then
  log_error "mongodump не найден на хосте и в Docker (контейнер fridge-mongodb / mongo)."
  log_error "На stellho: docker ps | grep fridge-mongodb"
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
log "Режим: $MONGODUMP_MODE${MONGO_DOCKER_CONTAINER:+ (контейнер $MONGO_DOCKER_CONTAINER)}"
log "Архив: $ARCHIVE_PATH"
SAFE_URI="$(printf '%s' "$MONGODB_URI" | sed -E 's|(//)[^/@]+@|\1***@|')"
log "URI (маскировано): $SAFE_URI"

if run_mongodump "$ARCHIVE_PATH" "$MONGODB_URI" >>"$LOG_FILE" 2>&1; then
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
