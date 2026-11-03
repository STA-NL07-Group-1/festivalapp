# Festivalapp

[![Security](https://github.com/STA-NL07-Group-1/festivalapp/actions/workflows/security.yml/badge.svg)](https://github.com/STA-NL07-Group-1/festivalapp/actions/workflows/security.yml)
[![OpenSSF Scorecard](https://api.scorecard.dev/projects/github.com/STA-NL07-Group-1/festivalapp/badge)](https://scorecard.dev/viewer/?uri=github.com/STA-NL07-Group-1/festivalapp)

Een Progressive Web App (PWA) voor festivalbezoekers: vind je vrienden op het terrein, stel je eigen timetable samen en blijf op de hoogte van updates en drukte. Gemaakt door STA-NL07 Groep 1.

> **Status:** in ontwikkeling — Sprint 1 (Fundament)

## Features

**MVP**

- Vrienden toevoegen via code en QR-code
- Live map met GPS-locatie van vrienden en pins droppen
- Chat met vrienden
- Timetable met live updates
- Pushmeldingen
- Noodbericht vanuit de organisatie en SOS-knop
- Instellingen: light/dark mode en taalkeuze
- Beheerportal voor de organisatie

**Uitbreidingen**

- Foto's delen met vrienden
- Timetable van vrienden bekijken
- Persoonlijke timetable met Spotify-koppeling
- Live drukte en aanmelden voor een show
- Acts beoordelen na afloop
- AI-chatbot
- Festival Wrapped
- Kompasmodus
- Spraakbediening
- Liedje herkennen

## Projectstructuur

```
festivalapp/
├── app/        PWA frontend
├── backend/    API, realtime-verbinding, pushmeldingen
├── portal/     Beheerportal voor de organisatie
├── infra/      Hosting, Docker, deployment
├── docs/       API-afspraken, architectuur, privacybeleid
├── .githooks/  Lokale secret-check vóór elke commit
└── .github/    Workflows, CODEOWNERS, templates
```

## Team

| Naam | Rol | Verantwoordelijk voor |
| --- | --- | --- |
| Bob | Network & Cloud | Backend, hosting, realtime, chat, pushmeldingen |
| Moses | Network & Cloud | Foto's, beheerportal, timetable-data, schaalbaarheid |
| _naam_ | Cyber Security | Accounts, vrienden via QR, privacy, noodbericht, SOS, repo-beveiliging |
| _naam_ | Software | PWA-basis, timetable, Spotify, instellingen, beoordelingen |
| _naam_ | IoT | Live map, drukte, aanmelden voor show, kompasmodus |
| _naam_ | Open Learning | AI-chatbot, spraak, liedje herkennen, Wrapped, UX-tests |

## Aan de slag

> De techstack wordt in Sprint 1 vastgesteld. Deze sectie vullen we aan zodra die bekend is.

1. Clone de repo:
   ```bash
   git clone https://github.com/STA-NL07-Group-1/festivalapp.git
   cd festivalapp
   ```
2. Kopieer `.env.example` naar `.env` en vul je eigen waarden in. Zet nooit echte keys in de repo.
3. Zet de secret-check aan, zodat je nooit per ongeluk een wachtwoord commit (eenmalig per computer):
   ```bash
   winget install Gitleaks.Gitleaks      # Mac: brew install gitleaks
   git config core.hooksPath .githooks
   ```
4. Installeer en start (volgt):
   ```bash
   # cd app && npm install && npm run dev
   ```

De app gebruikt camera, locatie, microfoon en pushmeldingen. Die werken alleen via **HTTPS** of `localhost`.

## Werkwijze

Alle taken staan als issues op het [projectbord](https://github.com/orgs/STA-NL07-Group-1/projects). We werken niet meer in Trello.

### Een taak oppakken

1. Kies een issue in **To do** en zet jezelf als **Assignee**.
2. Sleep de kaart naar **Bezig**.
3. Maak een branch met het issuenummer erin:
   ```bash
   git checkout main && git pull
   git checkout -b feature/12-accounts-login
   ```
4. Werk, commit en push:
   ```bash
   git add .
   git commit -m "Korte beschrijving van wat je deed"
   git push -u origin feature/12-accounts-login
   ```
5. Open op GitHub een pull request en zet in de beschrijving `Closes #12`.
6. Vraag een teamgenoot om een review. De kaart staat dan in **Review**.
7. Na goedkeuring en groene checks: **Squash and merge** en **Delete branch**. Het issue sluit vanzelf en de kaart gaat naar **Klaar**.

### Branchnamen

| Soort | Voorbeeld |
| --- | --- |
| Nieuwe feature | `feature/12-accounts-login` |
| Bug oplossen | `fix/27-chat-laadt-niet` |
| Documentatie | `docs/34-api-afspraken` |
| Overig (config, opruimen) | `chore/40-dependencies` |

### Regels

- `main` is beveiligd: niemand pusht er direct op.
- Elke pull request heeft **1 goedkeuring** van een teamgenoot nodig; je eigen pull request goedkeuren kan niet.
- De security-checks moeten groen zijn voordat je kunt mergen.
- Opmerkingen uit een review moeten opgelost zijn voordat je kunt mergen.
- Nieuwe taak of bug gevonden? Maak een issue aan met de templates **Feature of taak** of **Bug melden**.
- Nieuwe functionaliteit krijgt tests in de automatische testsuite.

## Security

Bij elke pull request draaien automatisch:

- **TruffleHog** — zoekt naar gelekte wachtwoorden, keys en tokens
- **Semgrep** — zoekt naar onveilige code
- **CodeQL** — code-analyse van GitHub
- **Dependency Review** — blokkeert nieuwe packages met bekende kwetsbaarheden
- **Dependabot** — waarschuwt bij kwetsbare packages en houdt versies bij
- **OpenSSF Scorecard** — wekelijkse security-score van de hele repo

Lokaal controleert **Gitleaks** elke commit op secrets voordat hij gemaakt wordt (zie *Aan de slag*, stap 3).

Een kwetsbaarheid gevonden? Lees [SECURITY.md](SECURITY.md) en meld het privé, niet via een openbaar issue.

## English summary

Festivalapp is a Progressive Web App (PWA) for festival visitors: find your friends on the festival grounds, build your own timetable, and stay up to date with schedule changes and crowd levels. It is a school project by STA-NL07 Group 1 and is currently in development.

The main documentation is in Dutch. Bug reports, questions and code comments in English are welcome via [issues](https://github.com/STA-NL07-Group-1/festivalapp/issues). Security issues: see [SECURITY.md](SECURITY.md).