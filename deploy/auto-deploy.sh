#!/bin/bash
# Zet nieuwe commits uit main automatisch live.
# We onthouden welke versie echt live staat (STATE). Mislukt het bouwen, dan blijft STATE op de oude
# versie staan en probeert de volgende ronde (over 2 minuten) het opnieuw. Eerder werd alleen naar de
# git-versie gekeken: die stond na een mislukte build al op de nieuwe versie, en dan werd het nooit
# meer geprobeerd.
set -e
cd /home/ubuntu/festivalapp
STATE=/home/ubuntu/.festivalapp-live
git fetch -q origin main
TARGET="$(git rev-parse origin/main)"
if [ "$TARGET" = "$(cat "$STATE" 2>/dev/null)" ]; then
  exit 0
fi
echo "Nieuwe versie: $(git log -1 --format='%h %s' origin/main)"
git reset -q --hard origin/main
docker compose -f compose.prod.yaml --env-file .env.production up -d --build
echo "$TARGET" > "$STATE"
docker image prune -f >/dev/null
echo "Klaar: $(git log -1 --format='%h')"
