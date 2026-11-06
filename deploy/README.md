# Deployen op de VPS

De festivalapp draait in vier containers: `db` (PostgreSQL), `backend` (API + WebSocket),
`web` (Caddy met de app op `/` en het portal op `/beheer`) en `tunnel` (Cloudflare Tunnel).
Er hoeft geen poort open op de server: al het verkeer komt binnen via de tunnel.

```
bezoeker ──HTTPS──▶ Cloudflare ──tunnel──▶ web (Caddy) ──▶ /api/* ──▶ backend ──▶ db
                                                   ├──▶ /beheer/*  portal
                                                   └──▶ /*         app (PWA)
```

## Eenmalig: tunnel aanmaken in Cloudflare

1. Cloudflare-dashboard → **Zero Trust** → **Networks** → **Tunnels** → **Create a tunnel**.
2. Kies **Cloudflared**, naam `festivalapp`.
3. Kopieer het **token**: het lange stuk na `--token` in het installatiecommando. Installeer niets; de
   container doet dat.
4. Bij **Public hostname**: subdomain `festivalapp`, domain `nulllabx.com`, type **HTTP**, URL `web:80`.
   Cloudflare maakt het DNS-record zelf aan.

## Eenmalig: op de VPS

```bash
git clone https://github.com/<organisatie>/festivalapp.git ~/festivalapp
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
```

Daarna: tickets importeren via `https://festivalapp.nulllabx.com/beheer` → Tickets.

## Bijwerken na een merge naar main

```bash
cd ~/festivalapp
git pull
sudo docker compose -f compose.prod.yaml --env-file .env.production up -d --build
```

Nieuwe databasemigraties draaien automatisch bij het starten van de backend.

## Handig

```bash
# Logs bekijken
sudo docker compose -f compose.prod.yaml logs -f backend
# Status
sudo docker compose -f compose.prod.yaml ps
# Back-up van de database
sudo docker compose -f compose.prod.yaml exec db pg_dump -U festivalapp festivalapp > backup-$(date +%F).sql
```
