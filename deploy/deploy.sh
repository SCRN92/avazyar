#!/usr/bin/env bash
# Deploy Avazyar to a server over SSH: run the tests, copy the project,
# rebuild the container and wait for it to report healthy.
#
#   ./deploy/deploy.sh <ssh-host> [remote-dir]
#
# The server needs Docker with the compose plugin. TLS is handled by the
# reverse proxy in front (see deploy/avazyar.noonbarbari.xyz.conf).
set -euo pipefail

host="${1:?usage: deploy/deploy.sh <ssh-host> [remote-dir]}"
dir="${2:-avazyar}"
cd "$(dirname "$0")/.."

echo "==> tests"
node --test

echo "==> copy to $host:$dir"
rsync -az --exclude .git --exclude .DS_Store --exclude node_modules ./ "$host:$dir/"

version=$(sed -n "s/.*AVAZYAR_VERSION = '\(.*\)'.*/\1/p" js/version.js)

echo "==> build and restart (image avazyar:$version)"
# The plain "default" builder always exists, whatever builder the server has selected
ssh "$host" "cd '$dir' && AVAZYAR_TAG='$version' BUILDX_BUILDER=\${BUILDX_BUILDER:-default} docker compose up -d --build --quiet-pull 2>&1 | tail -5"

echo "==> wait for healthy"
ssh "$host" '
  for i in $(seq 1 30); do
    s=$(docker inspect -f "{{.State.Health.Status}}" avazyar 2>/dev/null || echo missing)
    [ "$s" = healthy ] && break
    sleep 2
  done
  echo "container: $s"
  [ "$s" = healthy ]
'

echo "==> deployed version $version"
