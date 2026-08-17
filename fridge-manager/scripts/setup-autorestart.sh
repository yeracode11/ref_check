#!/usr/bin/env bash
# PM2 autostart при перезагрузке сервера + cron watchdog каждые 2 минуты.
#   sudo bash scripts/setup-autorestart.sh
set -euo pipefail

APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
WATCHDOG="$APP_DIR/scripts/watchdog-health.sh"
CRON_LINE="*/2 * * * * $WATCHDOG"

chmod +x "$WATCHDOG"

echo "[autorestart] PM2 startup (systemd)..."
if command -v pm2 >/dev/null 2>&1; then
  cd "$APP_DIR"
  if pm2 describe fridge-manager >/dev/null 2>&1; then
    pm2 restart ecosystem.config.js --update-env || pm2 start ecosystem.config.js
  else
    pm2 start ecosystem.config.js
  fi
  pm2 save
  startup_cmd="$(env PATH="$PATH:/usr/bin" pm2 startup systemd -u root --hp /root 2>&1 | grep -E '^sudo env' || true)"
  if [[ -n "$startup_cmd" ]]; then
    bash -c "$startup_cmd" || true
  fi
  pm2 save
else
  echo "[autorestart] WARNING: pm2 not found"
fi

echo "[autorestart] Cron watchdog..."
touch /var/log/fridge-watchdog.log
chmod 644 /var/log/fridge-watchdog.log
( crontab -l 2>/dev/null | grep -Fv "$WATCHDOG" || true
  echo "$CRON_LINE"
) | crontab -

echo "[autorestart] OK — pm2 startup + cron every 2 min"
crontab -l | grep -F "$WATCHDOG" || true
