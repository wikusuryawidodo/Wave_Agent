#!/usr/bin/env bash
set -euo pipefail
# Run as root after copying this project to /opt/meridian.
apt-get update
apt-get install -y ca-certificates curl
if ! command -v node >/dev/null 2>&1; then
  echo "Install Node.js 22 using the official NodeSource or Node.js distribution instructions, then rerun."
  exit 1
fi
node -e "if (Number(process.versions.node.split('.')[0]) < 22) process.exit(1)"
id meridian >/dev/null 2>&1 || useradd --system --home /opt/meridian --shell /usr/sbin/nologin meridian
install -d -o meridian -g meridian /opt/meridian /etc/meridian /var/log/meridian
chown -R meridian:meridian /opt/meridian
cd /opt/meridian
npm install --omit=dev
if [ ! -f /etc/meridian/meridian.env ]; then
  install -m 600 -o root -g root .env.example /etc/meridian/meridian.env
  echo "Edit /etc/meridian/meridian.env and set METEORA_POOL_ADDRESS + HELIUS_RPC_URL before starting."
fi
install -m 644 deploy/meridian.service /etc/systemd/system/meridian.service
systemctl daemon-reload
echo "Installed. Configure /etc/meridian/meridian.env, then run: systemctl enable --now meridian"
