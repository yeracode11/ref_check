#!/usr/bin/env bash
#
# Установка MongoDB Community на Ubuntu (20.04 focal / 22.04 jammy / 24.04 noble).
# Исправляет частую ошибку: репозиторий focal на jammy → libssl1.1 not installable.
#
#   sudo MONGO_CACHE_GB=1 bash scripts/install-mongodb-ubuntu.sh
#   sudo bash scripts/install-mongodb-docker.sh   # если apt снова конфликтует
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${ENV_FILE:-$SCRIPT_DIR/../.env}"
CACHE_GB="${MONGO_CACHE_GB:-1}"

if [[ "$(id -u)" -ne 0 ]]; then
  echo "[install-mongo] Запустите от root: sudo bash scripts/install-mongodb-ubuntu.sh"
  exit 1
fi

if ! grep -qi ubuntu /etc/os-release 2>/dev/null; then
  echo "[install-mongo] Не Ubuntu. Альтернатива: bash scripts/install-mongodb-docker.sh"
  exit 1
fi

# shellcheck disable=SC1091
source /etc/os-release
UBUNTU_CODENAME="${VERSION_CODENAME:-}"
VERSION_ID="${VERSION_ID:-}"

if [[ -z "$UBUNTU_CODENAME" ]]; then
  echo "[install-mongo] ERROR: не определён VERSION_CODENAME в /etc/os-release"
  exit 1
fi

# Версия MongoDB по Ubuntu (официальные репозитории)
case "$UBUNTU_CODENAME" in
  focal)  MONGO_VERSION="${MONGO_VERSION:-6.0}" ;;
  jammy|noble) MONGO_VERSION="${MONGO_VERSION:-7.0}" ;;
  *)
    echo "[install-mongo] Неподдерживаемый codename: $UBUNTU_CODENAME ($VERSION_ID)"
    echo "[install-mongo] Попробуйте: bash scripts/install-mongodb-docker.sh"
    exit 1
    ;;
esac

echo "[install-mongo] Ubuntu ${VERSION_ID} (${UBUNTU_CODENAME}), MongoDB ${MONGO_VERSION}, cache ${CACHE_GB} GB"

if command -v mongosh >/dev/null 2>&1; then
  if mongosh --quiet "mongodb://127.0.0.1:27017/admin" --eval 'db.runCommand({ping:1}).ok' 2>/dev/null | grep -q '^1$'; then
    echo "[install-mongo] MongoDB уже отвечает на 127.0.0.1:27017"
    exit 0
  fi
fi

apt-get update -qq
apt-get install -y gnupg curl ca-certificates

# Удалить старые/чужие list (focal на jammy → libssl1.1)
rm -f /etc/apt/sources.list.d/mongodb-org-*.list
for f in /etc/apt/trusted.gpg.d/mongodb*.gpg; do
  [[ -f "$f" ]] && rm -f "$f"
done

KEYRING="/usr/share/keyrings/mongodb-server-${MONGO_VERSION}.gpg"
rm -f "$KEYRING"
curl -fsSL "https://www.mongodb.org/static/pgp/server-${MONGO_VERSION}.asc" | gpg --dearmor --yes -o "$KEYRING"

LIST="/etc/apt/sources.list.d/mongodb-org-${MONGO_VERSION}.list"
echo "deb [ arch=amd64,arm64 signed-by=${KEYRING} ] https://repo.mongodb.org/apt/ubuntu ${UBUNTU_CODENAME}/mongodb-org/${MONGO_VERSION} multiverse" >"$LIST"

echo "[install-mongo] APT source: ${UBUNTU_CODENAME}/mongodb-org/${MONGO_VERSION}"
apt-get update -qq

if ! apt-get install -y mongodb-org mongodb-mongosh mongodb-database-tools; then
  echo "[install-mongo] ERROR: apt install failed (часто libssl / неверный codename)."
  echo "[install-mongo] Проверьте: cat /etc/os-release && cat $LIST"
  echo "[install-mongo] Альтернатива: bash scripts/install-mongodb-docker.sh"
  exit 1
fi

CONF="/etc/mongod.conf"
if [[ -f "$CONF" ]] && ! grep -q 'cacheSizeGB' "$CONF"; then
  python3 - <<PY
import re
path = "$CONF"
cache = "$CACHE_GB"
with open(path) as f:
    text = f.read()
if "cacheSizeGB" not in text:
    if re.search(r"^storage:", text, re.M):
        text = re.sub(
            r"(^storage:\s*\n)",
            r"\1  wiredTiger:\n    engineConfig:\n      cacheSizeGB: " + cache + "\n",
            text,
            count=1,
            flags=re.M,
        )
    else:
        text = (
            "storage:\n  wiredTiger:\n    engineConfig:\n      cacheSizeGB: "
            + cache
            + "\n\n"
            + text
        )
    with open(path, "w") as f:
        f.write(text)
PY
fi

systemctl daemon-reload
systemctl enable mongod
systemctl restart mongod

sleep 2
if ! systemctl is-active --quiet mongod; then
  echo "[install-mongo] mongod не запустился:"
  journalctl -u mongod -n 40 --no-pager || true
  exit 1
fi

echo "[install-mongo] mongod active"

if [[ -f "$ENV_FILE" ]]; then
  line="$(grep -E '^[[:space:]]*MONGODB_URI=' "$ENV_FILE" | tail -n1 || true)"
  uri="${line#MONGODB_URI=}"
  uri="${uri#\"}"; uri="${uri%\"}"; uri="${uri#\'}"; uri="${uri%\'}"

  if [[ "$uri" =~ mongodb://([^:/]+):([^@]+)@ ]]; then
    MONGO_USER="${BASH_REMATCH[1]}"
    MONGO_PASS="${BASH_REMATCH[2]}"
    echo "[install-mongo] Пользователь из .env: $MONGO_USER"
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

mongosh --quiet "mongodb://127.0.0.1:27017/admin" --eval 'db.runCommand({ping:1})'
echo "[install-mongo] OK"
