#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="${PROJECT_DIR:-/opt/qcc}"
CERT_NAME="${CERT_NAME:-1.14.142.128}"

cd "$PROJECT_DIR"

cert_file="$PROJECT_DIR/runtime/letsencrypt/live/$CERT_NAME/fullchain.pem"
before_mtime=0
if [ -f "$cert_file" ]; then
  before_mtime="$(stat -c %Y "$cert_file")"
fi

docker compose run --rm certbot renew --quiet

after_mtime=0
if [ -f "$cert_file" ]; then
  after_mtime="$(stat -c %Y "$cert_file")"
fi

if [ "$after_mtime" -gt "$before_mtime" ]; then
  docker compose exec -T caddy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile || \
    docker compose restart caddy
fi
