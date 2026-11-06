<p align="center">
  <img src="app/public/logo.png" alt="Festivalapp-logo" width="128" height="128">
</p>

<h1 align="center">Festivalapp</h1>

<p align="center">Vind je vrienden op het terrein, stel je eigen timetable samen en krijg live updates van de organisatie.</p>

Progressive Web App voor festivalbezoekers van **STA-NL07 Groep 1**, met een apart beheerportal
voor de organisatie. Periode: 9 november – woensdag 9 december 2026 (oplevering).

## Starten

Je hebt **Node.js 24** en **PostgreSQL 16** nodig (of Docker voor de database).

```bash
npm ci                         # installeren (zet ook de Git-hooks aan)
cp .env.example .env           # en vul JWT_SECRET in
docker compose up -d           # PostgreSQL (of gebruik je eigen installatie)
npm run db:migrate             # tabellen aanmaken
npm run db:seed                # demo-data: podia, timetable, tickets, accounts
npm run dev                    # backend, app en portal tegelijk
```

| Wat | Adres |
|---|---|
| App (PWA) | http://localhost:5173 |
| Beheerportal | http://localhost:5174 |
| API | http://localhost:3000 (`/health`) |

**Demo-accounts** (wachtwoord `Festival-demo-2026`, alleen lokaal):
`anna@festival.test` en `bram@festival.test` (bezoekers, al vrienden),
`organisatie@festival.test` en `beheerder@festival.test` (portal).
Zelf registreren kan met ticketcodes `DEMO-0001` t/m `DEMO-0048`.

## Overige commando's

```bash
npm test             # alle tests (backend-tests draaien als TEST_DATABASE_URL in .env staat)
npm run lint         # ESLint (incl. security-regels)
npm run typecheck    # TypeScript
npm run build        # productie-build van app en portal
npm run gen:api      # TypeScript-types opnieuw genereren uit backend/api.yaml
```

## Mappen

```
app/                PWA — React + TypeScript + vite-plugin-pwa (Niek)
├── src/screens/    Kaart, Timetable, Vrienden, Chat, Meldingen, Meer (instellingen + assistent)
├── src/sw.ts       Service worker: offline + pushmeldingen
└── src/i18n/       Nederlands en Engels
portal/             Beheerportal — SOS, mededelingen, timetable, drukte, tickets (Moses)
backend/            Node.js 24 + TypeScript, REST + WebSockets (Bob)
├── api.yaml        API-specificatie (OpenAPI 3.1) — het contract; requests worden hiertegen gevalideerd
├── src/routes/     auth, social (vrienden/locatie/pins/chat), program, organisation, chatbot
├── db/             PostgreSQL-schema: 17 tabellen, diagram, constraint-test
├── scripts/        migrate en seed
└── test/           Integratietests tegen een echte database
.githooks/          pre-commit (Gitleaks, geen .env), prepare-commit-msg (DCO)
.github/            CODEOWNERS, CI, security-scans, Dependabot, PR-sjabloon
```

## Wat zit erin

| MVP | Waar |
|---|---|
| Accounts gekoppeld aan een festivalticket | `backend/src/routes/auth.ts`, `app/src/screens/AuthScreen.tsx` |
| Vrienden via tijdelijke code of QR | `social.ts`, `FriendsScreen.tsx` (QR tonen + scannen) |
| Live kaart met vrienden en pins | `social.ts`, `MapScreen.tsx` (Leaflet + OpenStreetMap) |
| Chat tussen vrienden | `social.ts`, `ChatScreen.tsx` |
| Timetable met live updates | `program.ts`, `TimetableScreen.tsx` |
| Pushmeldingen | `backend/src/push.ts`, `app/src/sw.ts`, `app/src/lib/push.ts` |
| Noodberichten en SOS-knop | `organisation.ts`, `SosButton.tsx`, noodbanner in `App.tsx` |
| Licht/donker, Nederlands/Engels | `MoreScreen.tsx`, `app/src/i18n/` |
| Beheerportal | `portal/` |

| Extra | Waar |
|---|---|
| IoT: live drukte + aanmelden voor shows | `POST /iot/crowd-readings`, drukte op de kaart, aanmelden in de timetable |
| Open Learning: AI-chatbot | `backend/src/routes/chatbot.ts` — FAQ + timetable; met `AI_API_KEY` een taalmodel |
| Software: persoonlijke timetable + die van vrienden | `TimetableScreen.tsx` (tabs "Mijn timetable" en "Vrienden") |

## Security in het kort

- Alle request bodies worden gevalideerd tegen `backend/api.yaml` (onbekende velden → 400).
- Wachtwoorden met argon2id; tokens en codes alleen als SHA-256-hash in de database.
- Access-token 15 minuten; refresh-token roteert, hergebruik trekt alle sessies in.
- Rate limiting op inloggen, registreren, vriendcodes, SOS, chat en chatbot.
- Locatie en timetable delen staan standaard uit; alleen de laatste locatie, max. 10 minuten.
- Rollen worden in de backend afgedwongen; portal-acties komen in een append-only `audit_log`.
- Pushmeldingen bevatten geen chatinhoud; de chatbot krijgt geen persoonsgegevens.

## Team

| Naam | Rol | Hoofdtaken |
|---|---|---|
| Bob | Network & Cloud | Backend, database, hosting, realtime, chat, push |
| Moses | Network & Cloud | Timetable-data, beheerportal, loadtests |
| Gijs | Cyber Security | Login, vriendcodes, privacy, noodberichten, SOS, beveiliging |
| Niek | Software | De app, schermen, designsysteem, timetable, instellingen |
| Christian | IoT | Live kaart, drukte meten, aanmelden voor shows |
| Dean | Open Learning | AI-chatbot, gebruikerstests |

## Werkwijze

- Werk op een eigen branch en open een **pull request** naar `main`.
- CI moet groen zijn en de **code owner** van de map moet goedkeuren.
- Commits zijn **ondertekend** (`git config --global commit.gpgsign true`); de hook voegt `Signed-off-by` toe.
- Geen geheimen in Git: gebruik `.env` (staat in `.gitignore`).
