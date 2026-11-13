#!/bin/bash
# Controleert elke 5 minuten (systemd-timer) of festivalbuddy.nl werkt: Cloudflare, tunnel, Caddy,
# backend en database in één keer, via /api/health.
# Mislukt het 2 keer achter elkaar, dan gaat er één mail naar ALERT_EMAIL. Werkt het weer, dan nog één.
# De mail gaat via Resend, met de RESEND_API_KEY die al in .env.production staat.
set -u

# Met ENV_FILE, STATE_DIR, RESEND_URL en HEALTH_URL kun je het script ook lokaal testen
ENV_FILE=${ENV_FILE:-/home/ubuntu/festivalapp/.env.production}
STATE_DIR=${STATE_DIR:-/var/lib/festivalapp-health}
RESEND_URL=${RESEND_URL:-https://api.resend.com/emails}
FAILS_BEFORE_ALERT=2

# Alleen de regels lezen die we nodig hebben (geen hele .env uitvoeren)
value() { grep -E "^$1=" "$ENV_FILE" | tail -n 1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//'; }
DOMAIN=$(value DOMAIN)
ALERT_EMAIL=$(value ALERT_EMAIL)
RESEND_API_KEY=$(value RESEND_API_KEY)
MAIL_FROM=$(value MAIL_FROM)
MAIL_FROM=${MAIL_FROM:-Festival Buddy <no-reply@festivalbuddy.nl>}
URL=${HEALTH_URL:-https://${DOMAIN}/api/health}

mkdir -p "$STATE_DIR"
FAILS=$(cat "$STATE_DIR/fails" 2>/dev/null || echo 0)
ALERTED=$(cat "$STATE_DIR/alerted" 2>/dev/null || echo 0)

send_mail() {
  local subject=$1 text=$2
  if [ -z "$ALERT_EMAIL" ] || [ -z "$RESEND_API_KEY" ]; then
    echo "Geen ALERT_EMAIL of RESEND_API_KEY in $ENV_FILE: geen mail verstuurd ($subject)"
    return
  fi
  # JSON maken met python3 (staat standaard op Ubuntu), zodat aanhalingstekens in de tekst niets kapotmaken.
  # De sleutel gaat via een header-bestand op stdin, zodat hij niet in de proceslijst staat.
  FROM="$MAIL_FROM" TO="$ALERT_EMAIL" SUBJECT="$subject" TEXT="$text" python3 -c \
    'import json, os; print(json.dumps({"from": os.environ["FROM"], "to": [os.environ["TO"]], "subject": os.environ["SUBJECT"], "text": os.environ["TEXT"]}))' \
    >"$STATE_DIR/mail.json"
  printf 'Authorization: Bearer %s\n' "$RESEND_API_KEY" |
    curl -sS -o /dev/null -w "Resend: %{http_code}\n" --max-time 15 \
      -H @- -H "Content-Type: application/json" --data @"$STATE_DIR/mail.json" "$RESEND_URL"
  rm -f "$STATE_DIR/mail.json"
}

STATUS=$(curl -sS -o /dev/null -w "%{http_code}" --max-time 10 "$URL" 2>/dev/null || true)
NOW=$(date '+%d-%m-%Y %H:%M')

if [ "$STATUS" = "200" ]; then
  if [ "$ALERTED" = "1" ]; then
    echo "Weer online ($NOW)"
    send_mail "✅ ${DOMAIN} is weer online" "${URL} antwoordt weer met 200 (${NOW})."
  fi
  echo 0 >"$STATE_DIR/fails"
  echo 0 >"$STATE_DIR/alerted"
  exit 0
fi

FAILS=$((FAILS + 1))
echo "$FAILS" >"$STATE_DIR/fails"
echo "Controle mislukt ($FAILS keer achter elkaar): status ${STATUS:-geen antwoord}"

if [ "$FAILS" -ge "$FAILS_BEFORE_ALERT" ] && [ "$ALERTED" != "1" ]; then
  send_mail "⚠️ ${DOMAIN} ligt plat" "${URL} antwoordt niet goed (status: ${STATUS:-geen antwoord}), ${FAILS} controles achter elkaar sinds ongeveer ${NOW}.

Kijk op de server:
  sudo docker compose -f compose.prod.yaml --env-file .env.production ps
  sudo docker compose -f compose.prod.yaml --env-file .env.production logs --tail 100 backend
  journalctl -u festivalapp-health -n 20"
  echo 1 >"$STATE_DIR/alerted"
fi
