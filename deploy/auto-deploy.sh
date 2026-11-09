#!/bin/bash
# Zet nieuwe commits uit main automatisch live.
set -e
cd /home/ubuntu/festivalapp
git fetch -q origin main
if [ "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)" ]; then
  exit 0
fi
echo "Nieuwe versie: $(git log -1 --format='%h %s' origin/main)"
git reset -q --hard origin/main
docker compose -f compose.prod.yaml --env-file .env.production up -d --build
docker image prune -f >/dev/null
echo "Klaar: $(git log -1 --format='%h')"
