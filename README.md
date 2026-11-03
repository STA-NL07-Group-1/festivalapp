# Festivalapp

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
└── .github/    Workflows, CODEOWNERS, templates
```

## Team

| Naam | Rol | Verantwoordelijk voor |
| --- | --- | --- |
| Bob | Network & Cloud | Backend, hosting, realtime, chat, pushmeldingen |
| Moses | Network & Cloud | Foto's, beheerportal, timetable-data, schaalbaarheid |
| Gijs | Cyber Security | Accounts, vrienden via QR, privacy, noodbericht, SOS, repo-beveiliging |
| Niek | Software | PWA-basis, timetable, Spotify, instellingen, beoordelingen |
| Christian | IoT | Live map, drukte, aanmelden voor show, kompasmodus |
| Dean | Open Learning | AI-chatbot, spraak, liedje herkennen, Wrapped, UX-tests |

## Aan de slag

> De techstack wordt in Sprint 1 vastgesteld. Deze sectie vullen we aan zodra die bekend is.

1. Clone de repo:
   ```bash
   git clone https://github.com/STA-NL07-Group-1/festivalapp.git
   cd festivalapp
   ```
2. Kopieer `.env.example` naar `.env` en vul je eigen waarden in. Zet nooit echte keys in de repo.
3. Installeer en start (volgt):
   ```bash
   # cd app && npm install && npm run dev
   ```

De app gebruikt camera, locatie, microfoon en pushmeldingen. Die werken alleen via **HTTPS** of `localhost`.

## Werkwijze

- `main` is beveiligd: niemand pusht er direct op.
- Werk per taak in een eigen branch, bijvoorbeeld `feature/qr-vrienden` of `fix/login-bug`.
- Open een pull request en koppel het issue met `Closes #nummer`.
- Elke pull request heeft **1 goedkeuring** van een teamgenoot nodig en de checks moeten groen zijn.
- We mergen met **Squash and merge**.

```bash
git checkout main && git pull
git checkout -b feature/naam-van-taak
# werken en committen
git push -u origin feature/naam-van-taak
```

Taken en planning staan op het [projectbord](https://github.com/orgs/STA-NL07-Group-1/projects).

## Security

Bij elke pull request draaien automatisch:

- **TruffleHog** — zoekt naar gelekte wachtwoorden, keys en tokens
- **Semgrep** — zoekt naar onveilige code
- **CodeQL** — code-analyse van GitHub
- **Dependabot** — waarschuwt bij kwetsbare packages

Een kwetsbaarheid gevonden? Lees [SECURITY.md](SECURITY.md) en meld het privé, niet via een openbaar issue.
