#!/bin/sh
# Start the tunnel connector (if the TUNNEL_TOKEN secret is set) and the server.
# Secrets come from the Space settings as environment variables.
set -e
mkdir -p "$CACHE_DIR"
if [ -n "$TUNNEL_TOKEN" ]; then
  cloudflared tunnel --no-autoupdate run &
fi
exec node server/index.js
