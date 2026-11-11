# Deployen op de server (Educloud)

De festivalapp draait in vier containers: `db` (PostgreSQL), `backend` (API + WebSocket),
`web` (Caddy met de app op `/` en het portal op `/beheer`) en `tunnel` (Cloudflare Tunnel).
Er hoeft geen poort open op de server: al het verkeer komt binnen via de tunnel.

```
bezoeker ──HTTPS──▶ Cloudflare ──tunnel──▶ web (Caddy) ──▶ /api/* ──▶ backend ──▶ db
                                                   ├──▶ /beheer/*  portal
                                                   └──▶ /*         app (PWA)
```

De server staat op het schoolnetwerk van Fontys (Educloud) en heeft alleen een intern adres.
Beheren doe je met de **Educloud VPN** aan:

```bash
ssh ubuntu@10.61.0.240
```

Alle commands voor dagelijks gebruik staan in Notion op de pagina **Belangrijke commands (server)**.

## Eenmalig: tunnel aanmaken in Cloudflare

1. Cloudflare-dashboard → **Zero Trust** → **Networks** → **Tunnels** → **Create a tunnel**.
2. Kies **Cloudflared**, naam `festivalapp`.
3. Kopieer het **token**: het lange stuk na `--token` in het installatiecommando. Installeer niets; de
   container doet dat.
4. Bij **Public hostname**: subdomain `festivalapp`, domain `nulllabx.com`, type **HTTP**, URL `web:80`.
   Cloudflare maakt het DNS-record zelf aan.

## Eenmalig: op de server

```bash
git clone https://github.com/STA-NL07-Group-1/festivalapp.git ~/festivalapp
cd ~/festivalapp
cp deploy/env.production.example .env.production
nano .env.production          # vul alles in (zie de uitleg in het bestand)
chmod 600 .env.production

sudo docker compose -f compose.prod.yaml --env-file .env.production up -d --build

# Podia + timetable (zonder demo-accounts) en een portal-account
sudo docker compose -f compose.prod.yaml --env-file .env.production exec backend node scripts/seed.ts --programma
sudo docker compose -f compose.prod.yaml --env-file .env.production exec \
  -e ADMIN_EMAIL=jij@example.com -e ADMIN_NAME="Gijs" -e ADMIN_ROLE=beheerder -e ADMIN_PASSWORD='kies-een-sterk-wachtwoord' \
  backend node scripts/create-admin.ts

# Eén account "sudo" maken: dat mag bij elk festival en wijst eigenaren en beheerders aan.
# Het account moet al bestaan. Dit kan bewust alleen hier, niet via het portal.
sudo docker compose -f compose.prod.yaml --env-file .env.production exec \
  -e SUDO_EMAIL=jij@example.com backend node scripts/set-sudo.ts
```

De rol bij `create-admin.ts` (`beheerder`, `organisatie`, `ehbo` of `beveiliging`) geldt voor één
festival: standaard het eerste, of het festival waarvan je de id meegeeft met `-e ADMIN_FESTIVAL=...`.
Verdere teamleden voeg je toe in het portal, op de pagina Team.

Daarna: tickets importeren via `https://festivalapp.nulllabx.com/beheer` → Tickets.

### Automatisch bijwerken installeren

```bash
cp deploy/auto-deploy.sh ~/auto-deploy.sh
chmod +x ~/auto-deploy.sh
sudo cp deploy/festivalapp-deploy.service deploy/festivalapp-deploy.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now festivalapp-deploy.timer
```

## Automatisch bijwerken

Een systemd-timer kijkt elke 2 minuten of er een nieuwe commit in `main` staat. Zo ja, dan haalt
`auto-deploy.sh` de nieuwe versie op en bouwt de containers opnieuw. Nieuwe databasemigraties draaien
daarna vanzelf bij het starten van de backend. Na een merge hoef je dus niets te doen.

**Pas op de server geen bestanden in `~/festivalapp` aan.** De timer zet alles terug naar `main`.
Wijzigingen gaan altijd via een pull request. Alleen `.env.production` pas je op de server aan.

```bash
# Loopt de timer? (kijk bij NEXT en LAST)
systemctl list-timers festivalapp-deploy.timer
# Wat deden de laatste deploys?
journalctl -u festivalapp-deploy -n 30
# Nu meteen deployen in plaats van wachten
sudo systemctl start festivalapp-deploy.service
```

`flock` in de service zorgt dat er nooit twee deploys tegelijk lopen.

## Handig

```bash
# Logs bekijken
sudo docker compose -f compose.prod.yaml --env-file .env.production logs -f backend
# Status
sudo docker compose -f compose.prod.yaml --env-file .env.production ps
# Back-up van de database
sudo docker compose -f compose.prod.yaml --env-file .env.production exec -T db pg_dump -U festivalapp festivalapp > backup-$(date +%F).sql
```

> ⚠️ Gebruik nooit `down -v` of `docker system prune --volumes`. Dan is de hele database weg.
