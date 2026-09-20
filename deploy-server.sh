#!/usr/bin/env bash

set -Eeuo pipefail

APP_DIR="/opt/tgbottest"
RAW_URL="https://raw.githubusercontent.com/dvoeshnik381-code/tgbottest/main"
SERVICE_FILE="/etc/systemd/system/tgbottest.service"

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run this installer as root."
  exit 1
fi

echo "[1/5] Installing system packages..."
apt-get update
DEBIAN_FRONTEND=noninteractive apt-get install -y ca-certificates curl nodejs

node_major="$(node --version | sed -E 's/^v([0-9]+).*/\1/')"
if [[ -z "${node_major}" || "${node_major}" -lt 18 ]]; then
  echo "Node.js 18 or newer is required; installed version: $(node --version)"
  exit 1
fi

echo "[2/5] Downloading the bot..."
mkdir -p "${APP_DIR}/src" "${APP_DIR}/data"
curl -fsSL "${RAW_URL}/src/bot.js" -o "${APP_DIR}/src/bot.js"
curl -fsSL "${RAW_URL}/package.json" -o "${APP_DIR}/package.json"

if [[ ! -s "${APP_DIR}/.env" ]]; then
  read -r -s -p "Paste the BotFather token and press Enter: " bot_token </dev/tty
  echo
  if [[ -z "${bot_token}" ]]; then
    echo "The token cannot be empty."
    exit 1
  fi
  umask 077
  printf 'BOT_TOKEN=%s\nPOLL_TIMEOUT_SECONDS=30\n' "${bot_token}" > "${APP_DIR}/.env"
  unset bot_token
fi

chmod 600 "${APP_DIR}/.env"

echo "[3/5] Creating the system service..."
cat > "${SERVICE_FILE}" <<'UNIT'
[Unit]
Description=Telegram TBotTest
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=/opt/tgbottest
ExecStart=/usr/bin/node /opt/tgbottest/src/bot.js
Restart=always
RestartSec=5
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
UNIT

echo "[4/5] Starting the bot..."
systemctl daemon-reload
systemctl enable --now tgbottest.service
systemctl restart tgbottest.service

echo "[5/5] Checking status..."
sleep 2
systemctl --no-pager --full status tgbottest.service
echo
echo "Deployment complete. Logs: journalctl -u tgbottest -f"
