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
4. Bij **Public hostname**: subdomain leeg laten, domain `festivalbuddy.nl`, type **HTTP**, URL `web:80`.
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

Daarna: tickets importeren via `https://festivalbuddy.nl/beheer` → Tickets. Op die pagina zie je ook hoeveel
tickets er zijn en hoeveel al aan een account hangen.

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
# Wat deden de laatste deploys? (sudo: anders zie je de systeemlog niet)
sudo journalctl -u festivalapp-deploy -n 30
# Nu meteen deployen in plaats van wachten
sudo systemctl start festivalapp-deploy.service
```

`flock` in de service zorgt dat er nooit twee deploys tegelijk lopen.

Het script onthoudt in `~/.festivalapp-live` welke versie echt live staat. Mislukt het bouwen, dan
probeert de volgende ronde het opnieuw. Na een wijziging aan `auto-deploy.sh` kopieer je hem opnieuw
naar `~/auto-deploy.sh` (zie hierboven); de eerste ronde daarna bouwt één keer opnieuw.

### Docker Hub onbereikbaar (verkeerd certificaat)

Zie je in de log `tls: failed to verify certificate: x509: certificate is valid for …, not
registry-1.docker.io`, dan geeft de DNS van het schoolnetwerk verouderde adressen voor Docker Hub
(en IPv6 werkt op deze server niet). Gebeurd op 20 november 2026: daardoor stond er een paar dagen
een oude versie live. De server gebruikt daarom Cloudflare (1.1.1.1) en Quad9 (9.9.9.9) als DNS:

```bash
# Welke DNS gebruikt de server nu?
resolvectl status ens3 | grep -A2 "DNS Servers"
# Komt Docker Hub goed binnen? Hoort 401 te geven
curl -4 -s -o /dev/null -w "%{http_code}\n" https://registry-1.docker.io/v2/
```

Ingesteld met `deploy/dns.conf` (een aanvulling op het netwerkbestand dat netplan maakt):

```bash
sudo mkdir -p /etc/systemd/network/10-netplan-ens3.network.d
sudo cp deploy/dns.conf /etc/systemd/network/10-netplan-ens3.network.d/dns.conf
sudo networkctl reload
```

Let op: `networkctl reload` stelt de netwerkkaart opnieuw in. Je SSH-verbinding valt dan even weg en
de site is ongeveer een minuut onbereikbaar; daarna kun je weer inloggen. Lukt dat niet, gebruik dan de
console in het Educloud-portaal en haal het bestand weg (`sudo rm` + `sudo netplan apply`).

Schakel de controle van het certificaat nooit uit (`insecure-registries`): dan haal je mogelijk
images van een onbekende server binnen.

## Controleren of de site werkt (healthcheck)

Een systemd-timer draait elke 5 minuten `healthcheck.sh`. Die opent `https://<DOMAIN>/api/health` en test
zo de hele keten: Cloudflare, de tunnel, Caddy, de backend en de database. Mislukt het **2 keer achter
elkaar**, dan krijg je één mail. Werkt het weer, dan krijg je nog één mail. De mail gaat via Resend met de
`RESEND_API_KEY` uit `.env.production`; zet daar ook het adres in waar de melding heen moet:

```bash
nano ~/festivalapp/.env.production      # voeg toe: ALERT_EMAIL=jij@example.com
```

Eenmalig installeren (net als de auto-deploy):

```bash
cp ~/festivalapp/deploy/healthcheck.sh ~/healthcheck.sh
chmod +x ~/healthcheck.sh
sudo cp ~/festivalapp/deploy/festivalapp-health.service ~/festivalapp/deploy/festivalapp-health.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now festivalapp-health.timer
```

```bash
# Loopt de timer?
systemctl list-timers festivalapp-health.timer
# Nu meteen één controle doen
sudo systemctl start festivalapp-health.service
# Wat zeiden de laatste controles?
journalctl -u festivalapp-health -n 20
```

Na een wijziging aan `deploy/healthcheck.sh` op `main` kopieer je hem opnieuw naar `~/healthcheck.sh`
(de auto-deploy doet dat niet, net als bij `auto-deploy.sh`).

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
