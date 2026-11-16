#!/bin/bash
# Maakt een back-up van de database en bewaart de laatste 7 dagen.
set -euo pipefail
MAP=/var/backups/festivalapp
BEWAAR_DAGEN=7
BESTAND="$MAP/festivalapp-$(date +%F_%H%M).dump"

mkdir -p "$MAP"
chmod 700 "$MAP"
cd /home/ubuntu/festivalapp

# pg_dump draait in de db-container; -Fc = compact formaat voor pg_restore
docker compose -f compose.prod.yaml --env-file .env.production exec -T db \
  pg_dump -U festivalapp -Fc festivalapp > "$BESTAND.tmp"

# Leeg bestand = mislukt (dan niet als back-up laten staan)
[ -s "$BESTAND.tmp" ] || { rm -f "$BESTAND.tmp"; echo "Back-up is leeg"; exit 1; }
mv "$BESTAND.tmp" "$BESTAND"
chmod 600 "$BESTAND"

# Oude back-ups weggooien
find "$MAP" -name 'festivalapp-*.dump' -mtime +$((BEWAAR_DAGEN - 1)) -delete
echo "Back-up klaar: $BESTAND ($(du -h "$BESTAND" | cut -f1))"
