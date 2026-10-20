#!/usr/bin/env bash
# Ship the latest commit to the server. Run from the project root on your laptop:
#   deploy/deploy.sh root@SERVER_IP            deploy HEAD
#   deploy/deploy.sh root@SERVER_IP --env      also upload your local .env (API keys)
#   deploy/deploy.sh root@SERVER_IP --setup    first time: upload and run setup.sh
# Each deploy goes to its own folder; `current` switches only after the new
# version answers its health check, and the last 5 releases are kept.
set -euo pipefail
HOST="${1:?usage: deploy/deploy.sh root@SERVER_IP [--env] [--setup]}"
shift
WITH_ENV=0 SETUP=0
for a in "$@"; do
  case "$a" in
    --env) WITH_ENV=1 ;;
    --setup) SETUP=1 ;;
    *) echo "unknown option $a" >&2; exit 1 ;;
  esac
done

cd "$(git rev-parse --show-toplevel)"
if [ -n "$(git status --porcelain)" ]; then
  echo "! Uncommitted changes are NOT deployed (only the last commit is)." >&2
fi
SHA="$(git rev-parse --short HEAD)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

if [ "$SETUP" = 1 ]; then
  echo "==> Server setup"
  scp -q deploy/setup.sh deploy/aeon.service deploy/Caddyfile "$HOST:/root/"
  ssh "$HOST" 'bash /root/setup.sh'
fi

if [ "$WITH_ENV" = 1 ]; then
  echo "==> Uploading .env"
  scp -q .env "$HOST:/opt/aeon/shared/.env"
  ssh "$HOST" 'chown aeon:aeon /opt/aeon/shared/.env && chmod 600 /opt/aeon/shared/.env'
fi

echo "==> Packing $SHA"
git archive --format=tar.gz -o "$TMP/aeon.tgz" HEAD
scp -q "$TMP/aeon.tgz" "$HOST:/tmp/aeon-$SHA.tgz"

echo "==> Installing on server"
ssh "$HOST" SHA="$SHA" bash -s <<'REMOTE'
set -euo pipefail
REL=/opt/aeon/releases/$SHA
rm -rf "$REL" && mkdir -p "$REL"
tar xzf "/tmp/aeon-$SHA.tgz" -C "$REL" && rm "/tmp/aeon-$SHA.tgz"
cd "$REL"
npm ci --omit=dev --no-audit --no-fund --loglevel=error
chown -R aeon:aeon "$REL"
PREV="$(readlink /opt/aeon/current || true)"
ln -sfn "$REL" /opt/aeon/current
# Keep the newest service definition and proxy config with the code.
install -m 644 deploy/aeon.service /etc/systemd/system/aeon.service
if ! cmp -s deploy/Caddyfile /etc/caddy/Caddyfile; then install -m 644 deploy/Caddyfile /etc/caddy/Caddyfile && systemctl reload caddy; fi
systemctl daemon-reload
systemctl restart aeon
for i in $(seq 1 30); do
  if curl -fsS -o /dev/null http://127.0.0.1:3000/api/health; then OK=1; break; fi
  sleep 1
done
if [ "${OK:-0}" != 1 ]; then
  echo "! New version failed its health check; rolling back." >&2
  journalctl -u aeon -n 30 --no-pager >&2 || true
  if [ -n "$PREV" ]; then ln -sfn "$PREV" /opt/aeon/current && systemctl restart aeon; fi
  exit 1
fi
ls -1dt /opt/aeon/releases/* | tail -n +6 | xargs -r rm -rf
echo "==> Live: $SHA"
REMOTE
