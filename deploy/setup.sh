#!/usr/bin/env bash
# One-time server setup for a fresh Ubuntu 24.04 VPS. Run as root:
#   bash setup.sh
# Installs Node 22, Caddy and a firewall, creates the `aeon` user and service.
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive

echo "==> System packages"
apt-get update -q
apt-get upgrade -yq
apt-get install -yq curl ca-certificates gnupg ufw unattended-upgrades debian-keyring debian-archive-keyring apt-transport-https

echo "==> Node.js 22"
if ! command -v node >/dev/null || ! node -v | grep -q '^v2[2-9]'; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -yq nodejs
fi
node -v

echo "==> Caddy"
if ! command -v caddy >/dev/null; then
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -q
  apt-get install -yq caddy
fi
mkdir -p /var/log/caddy && chown caddy:caddy /var/log/caddy

echo "==> Swap (small VPS plans run out of memory during npm installs)"
if ! swapon --show | grep -q .; then
  fallocate -l 1G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

echo "==> App user and folders"
id aeon >/dev/null 2>&1 || useradd --system --create-home --home-dir /opt/aeon --shell /usr/sbin/nologin aeon
mkdir -p /opt/aeon/releases /opt/aeon/shared/cache
touch /opt/aeon/shared/.env
chmod 600 /opt/aeon/shared/.env
chown -R aeon:aeon /opt/aeon

echo "==> Firewall: SSH, HTTP, HTTPS only (Node's port 3000 stays private)"
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

echo "==> Automatic security updates"
dpkg-reconfigure -f noninteractive unattended-upgrades

echo "==> Service + reverse proxy"
install -m 644 "$(dirname "$0")/aeon.service" /etc/systemd/system/aeon.service
install -m 644 "$(dirname "$0")/Caddyfile" /etc/caddy/Caddyfile
systemctl daemon-reload
systemctl enable aeon caddy
systemctl reload caddy || systemctl restart caddy

echo "==> Setup done. Next: deploy the app from your laptop with deploy/deploy.sh"
