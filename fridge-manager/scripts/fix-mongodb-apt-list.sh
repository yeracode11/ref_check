#!/usr/bin/env bash
# Удаляет сломанный apt-репозиторий MongoDB (noble без Release file).
#   sudo bash scripts/fix-mongodb-apt-list.sh
set -euo pipefail
rm -f /etc/apt/sources.list.d/mongodb-org-*.list
for f in /etc/apt/trusted.gpg.d/mongodb*.gpg; do
  [[ -f "$f" ]] && rm -f "$f"
done
apt-get update -qq
echo "[fix-mongo-apt] OK — apt update прошёл без mongodb noble repo"
