# Aeon Network on a Hugging Face Docker Space (free CPU).
# Runs the Node server plus a Cloudflare Tunnel connector, so getaeon.network is served from
# here as well as from any other connector of the same tunnel (Cloudflare balances between them).
FROM node:22-slim

RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl tini \
  && curl -fsSL -o /usr/local/bin/cloudflared https://github.com/cloudflare/cloudflared/releases/download/2026.10.1/cloudflared-linux-amd64 \
  && chmod +x /usr/local/bin/cloudflared \
  && apt-get purge -y curl && rm -rf /var/lib/apt/lists/*

# Spaces run as uid 1000; give it the app folder and a writable cache.
WORKDIR /app
COPY --chown=1000:1000 package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund --loglevel=error
COPY --chown=1000:1000 . .
RUN chmod +x deploy/hf/start.sh
USER 1000
ENV NODE_ENV=production PORT=7860 CACHE_DIR=/tmp/aeon-cache
EXPOSE 7860
ENTRYPOINT ["tini", "--"]
CMD ["deploy/hf/start.sh"]
