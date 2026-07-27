#!/usr/bin/env bash
#
# Установка MongoDB Community на Ubuntu (22.04 jammy / 24.04 noble).
# Для VPS 4 GB задаёт wiredTiger cache ~1.25 GB.
#
# Использование (на сервере root):
#   bash scripts/install-mongodb-ubuntu.sh
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${ENV_FILE:-$SCRIPT_DIR/../.env}"
MONGO_VERSION="${MONGO_VERSION:-7.0}"
CACHE_GB="${MONGO_CACHE_GB:-1.25}"

if [[ "$(id -u)" -ne 0 ]]; then
  echo "[install-mongo] Запустите от root: sudo bash scripts/install-mongodb-ubuntu.sh"
  exit 1
fi

if ! grep -qi ubuntu /etc/os-release 2>/dev/null; then
  echo "[install-mongo] Скрипт рассчитан на Ubuntu. Для других ОС: https://www.mongodb.com/docs/manual/administration/install-on-linux/"
  exit 1
fi

# Уже слушает порт?
if command -v mongosh >/dev/null 2>&1; then
  if mongosh --quiet "mongodb://127.0.0.1:27017/admin" --eval 'db.runCommand({ping:1}).ok' 2>/dev/null | grep -q '^1$'; then
    echo "[install-mongo] MongoDB уже отвечает на 127.0.0.1:27017"
    exit 0
  fi
fi

# --- codename для репозитория ---
# shellcheck disable=SC1091
source /etc/os-release
case "${VERSION_ID:-}" in
  22.04) UBUNTU_CODENAME="jammy" ;;
  24.04) UBUNTU_CODENAME="noble" ;;
  *)
    UBUNTU_CODENAME="${VERSION_CODENAME:-jammy}"
    echo "[install-mongo] Нестандартная версия Ubuntu ($VERSION_ID), пробуем codename=$UBUNTU_CODENAME"
    ;;
esac

echo "[install-mongo] Ubuntu $VERSION_ID ($UBUNTU_CODENAME), MongoDB $MONGO_VERSION"

apt-get update -qq
apt-get install -y gnupg curl ca-certificates

KEYRING="/usr/share/keyrings/mongodb-server-${MONGO_VERSION}.gpg"
if [[ ! -f "$KEYRING" ]]; then
  curl -fsSL "https://www.mongodb.org/static/pgp/server-${MONGO_VERSION}.asc" | gpg --dearmor -o "$KEYRING"
fi

LIST="/etc/apt/sources.list.d/mongodb-org-${MONGO_VERSION}.list"
if [[ ! -f "$LIST" ]]; then
  echo "deb [ arch=amd64,arm64 signed-by=${KEYRING} ] https://repo.mongodb.org/apt/ubuntu ${UBUNTU_CODENAME}/mongodb-org/${MONGO_VERSION} multiverse" >"$LIST"
fi

apt-get update -qq
apt-get install -y mongodb-org mongodb-mongosh mongodb-database-tools

# Ограничение RAM (важно на 4 GB VPS рядом с Node)
CONF="/etc/mongod.conf"
if [[ -f "$CONF" ]] && ! grep -q 'cacheSizeGB' "$CONF"; then
  echo "[install-mongo] Настройка wiredTiger.cacheSizeGB=${CACHE_GB} в $CONF"
  if grep -q 'wiredTiger:' "$CONF"; then
    sed -i "/wiredTiger:/,/engineConfig:/ s/engineConfig:/engineConfig:\n      cacheSizeGB: ${CACHE_GB}/" "$CONF" 2>/dev/null || true
  fi
  if ! grep -q 'cacheSizeGB' "$CONF"; then
    cat >>"$CONF" <<EOF

# Added by install-mongodb-ubuntu.sh (low-RAM VPS)
setParameter:
  enableLocalhostAuthBypass: true
EOF
    # Append storage block if missing — safer to use yq but avoid dependency; patch storage section
    python3 - <<PY 2>/dev/null || true
import re
path = "$CONF"
cache = float("$CACHE_GB")
with open(path) as f:
    text = f.read()
if "cacheSizeGB" not in text:
    if re.search(r"^storage:", text, re.M):
        text = re.sub(
            r"(^storage:\s*\n)",
            r"\1  wiredTiger:\n    engineConfig:\n      cacheSizeGB: " + str(cache) + "\n",
            text,
            count=1,
            flags=re.M,
        )
    else:
        text = "storage:\n  wiredTiger:\n    engineConfig:\n      cacheSizeGB: " + str(cache) + "\n\n" + text
    with open(path, "w") as f:
        f.write(text)
PY
  fi
fi

systemctl daemon-reload
systemctl enable mongod
systemctl start mongod

sleep 2
if ! systemctl is-active --quiet mongod; then
  echo "[install-mongo] mongod не запустился. Лог:"
  journalctl -u mongod -n 40 --no-pager || true
  exit 1
fi

echo "[install-mongo] mongod active"

# --- пользователь из .env (если URI с логином/паролем) ---
if [[ -f "$ENV_FILE" ]]; then
  line="$(grep -E '^[[:space:]]*MONGODB_URI=' "$ENV_FILE" | tail -n1 || true)"
  uri="${line#MONGODB_URI=}"
  uri="${uri#\"}"; uri="${uri%\"}"; uri="${uri#\'}"; uri="${uri%\'}"

  if [[ "$uri" =~ mongodb://([^:/]+):([^@]+)@ ]]; then
    MONGO_USER="${BASH_REMATCH[1]}"
    MONGO_PASS="${BASH_REMATCH[2]}"
    echo "[install-mongo] Создание/обновление пользователя admin: $MONGO_USER"
    mongosh --quiet "mongodb://127.0.0.1:27017/admin" <<MJS
try {
  db.createUser({
    user: "$MONGO_USER",
    pwd: "$MONGO_PASS",
    roles: [
      { role: "root", db: "admin" },
      { role: "readWrite", db: "fridge_manager" },
    ],
  });
  print("User created");
} catch (e) {
  if (e.codeName === "DuplicateKey" || /already exists/i.test(e.message)) {
    db.updateUser("$MONGO_USER", {
      pwd: "$MONGO_PASS",
      roles: [
        { role: "root", db: "admin" },
        { role: "readWrite", db: "fridge_manager" },
      ],
    });
    print("User updated");
  } else {
    throw e;
  }
}
MJS
    # Включить auth, если ещё нет
    if [[ -f "$CONF" ]] && ! grep -q 'authorization: enabled' "$CONF"; then
      if grep -q '^security:' "$CONF"; then
        sed -i 's/authorization:.*/authorization: enabled/' "$CONF" || true
      else
        echo -e "\nsecurity:\n  authorization: enabled" >>"$CONF"
      fi
      systemctl restart mongod
      sleep 2
    fi
  fi
fi

mongosh --quiet "mongodb://127.0.0.1:27017/admin" --eval 'db.runCommand({ping:1})' || {
  echo "[install-mongo] ping failed — проверьте MONGODB_URI и auth"
  exit 1
}

echo ""
echo "[install-mongo] Готово."
echo "  systemctl status mongod"
echo "  cd $(dirname "$SCRIPT_DIR")/fridge-manager && bash scripts/restart-production.sh"
echo ""
echo "Если база была раньше — восстановите из бэкапа:"
echo "  mongorestore --gzip --archive=/backups/fridge_manager_XXXX.gz --drop"
echo "  (URI из .env: mongorestore --uri=\"\$MONGODB_URI\" ...)"
