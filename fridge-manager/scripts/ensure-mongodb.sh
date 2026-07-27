#!/usr/bin/env bash
# Проверка MongoDB на localhost и попытка запуска (Ubuntu/Debian systemd).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOST="${MONGO_HOST:-127.0.0.1}"
PORT="${MONGO_PORT:-27017}"

ping_mongo() {
  if command -v mongosh >/dev/null 2>&1; then
    mongosh --quiet "mongodb://${HOST}:${PORT}/admin" --eval 'db.runCommand({ ping: 1 }).ok' 2>/dev/null | grep -q '^1$'
    return $?
  fi
  if command -v mongo >/dev/null 2>&1; then
    mongo --quiet "mongodb://${HOST}:${PORT}/admin" --eval 'db.runCommand({ ping: 1 }).ok' 2>/dev/null | grep -q '^1$'
    return $?
  fi
  if command -v nc >/dev/null 2>&1; then
    nc -z -w 2 "$HOST" "$PORT" 2>/dev/null
    return $?
  fi
  (echo >/dev/tcp/"$HOST"/"$PORT") 2>/dev/null
}

start_mongo_service() {
  if command -v systemctl >/dev/null 2>&1; then
    if systemctl list-unit-files mongod.service 2>/dev/null | grep -q mongod.service; then
      echo "[mongo] Starting mongod via systemctl..."
      sudo systemctl start mongod
      return 0
    fi
    if systemctl list-unit-files mongodb.service 2>/dev/null | grep -q mongodb.service; then
      echo "[mongo] Starting mongodb via systemctl..."
      sudo systemctl start mongodb
      return 0
    fi
  fi
  if command -v service >/dev/null 2>&1; then
    echo "[mongo] Trying: service mongod start"
    sudo service mongod start 2>/dev/null || sudo service mongodb start 2>/dev/null || return 1
    return 0
  fi
  return 1
}

start_mongo_docker() {
  if ! command -v docker >/dev/null 2>&1; then
    return 1
  fi
  local name="${MONGO_DOCKER_NAME:-fridge-mongodb}"
  if docker ps --format '{{.Names}}' | grep -qx "$name"; then
    echo "[mongo] Docker container $name already running"
    return 0
  fi
  if docker ps -a --format '{{.Names}}' | grep -qx "$name"; then
    echo "[mongo] Starting docker container $name..."
    docker start "$name"
    return 0
  fi
  return 1
}

echo "[mongo] Checking ${HOST}:${PORT}..."
if ping_mongo; then
  echo "[mongo] OK — MongoDB responds"
  exit 0
fi

echo "[mongo] NOT running (connection refused or timeout)"

if start_mongo_service; then
  sleep 3
  if ping_mongo; then
    echo "[mongo] OK — started successfully"
    exit 0
  fi
fi

if start_mongo_docker; then
  sleep 3
  if ping_mongo; then
    echo "[mongo] OK — Docker MongoDB started"
    exit 0
  fi
fi

echo "[mongo] FAILED — MongoDB is not installed or not running"
echo "[mongo]"
if ! systemctl list-unit-files mongod.service 2>/dev/null | grep -q mongod.service; then
  echo "[mongo] Unit mongod.service not found → установите MongoDB:"
  echo "[mongo]   sudo bash $SCRIPT_DIR/install-mongodb-ubuntu.sh"
  echo "[mongo] или диагностика:"
  echo "[mongo]   bash $SCRIPT_DIR/detect-mongodb.sh"
else
  echo "[mongo]   sudo systemctl status mongod"
  echo "[mongo]   sudo journalctl -u mongod -n 50 --no-pager"
fi
echo "[mongo] On 4GB VPS, mongod may be OOM-killed — check: dmesg | tail | grep -i kill"
echo "[mongo] Then: pm2 restart fridge-manager"
exit 1
