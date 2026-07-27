#!/usr/bin/env bash
# Где MongoDB на этом сервере (systemd / docker / не установлен)
set -euo pipefail

HOST="${MONGO_HOST:-127.0.0.1}"
PORT="${MONGO_PORT:-27017}"

echo "=== MongoDB detection ==="

port_open() {
  (echo >/dev/tcp/"$HOST"/"$PORT") 2>/dev/null
}

if port_open; then
  echo "Port ${HOST}:${PORT}: OPEN"
else
  echo "Port ${HOST}:${PORT}: CLOSED"
fi

echo ""
echo "--- Binaries ---"
for cmd in mongod mongosh mongodump docker; do
  if command -v "$cmd" >/dev/null 2>&1; then
    echo "  $cmd: $(command -v "$cmd")"
  else
    echo "  $cmd: not found"
  fi
done

echo ""
echo "--- systemd ---"
for unit in mongod mongodb; do
  if systemctl list-unit-files "${unit}.service" 2>/dev/null | grep -q "${unit}.service"; then
    systemctl is-active "${unit}.service" 2>/dev/null || true
    systemctl status "${unit}.service" --no-pager -l 2>/dev/null | head -5 || true
  else
    echo "  ${unit}.service: not installed"
  fi
done

echo ""
echo "--- Docker ---"
if command -v docker >/dev/null 2>&1; then
  docker ps --format 'table {{.Names}}\t{{.Image}}\t{{.Ports}}' 2>/dev/null | grep -i mongo || echo "  no mongo container running"
else
  echo "  docker not installed"
fi

echo ""
echo "--- Data dirs ---"
for d in /var/lib/mongodb /data/db /var/lib/mongo; do
  if [[ -d "$d" ]]; then
    echo "  $d exists ($(du -sh "$d" 2>/dev/null | cut -f1))"
  fi
done

if [[ -d /backups ]]; then
  echo ""
  echo "--- Recent backups (/backups) ---"
  ls -1t /backups/fridge_manager_*.gz 2>/dev/null | head -3 || echo "  none"
fi

echo ""
if ! port_open; then
  if ! systemctl list-unit-files mongod.service 2>/dev/null | grep -q mongod.service; then
    echo "MongoDB не установлен. На Ubuntu:"
    echo "  cd fridge-manager && sudo bash scripts/install-mongodb-ubuntu.sh"
  else
    echo "MongoDB установлен, но не слушает порт. Попробуйте:"
    echo "  sudo systemctl start mongod && sudo journalctl -u mongod -n 50"
  fi
fi
