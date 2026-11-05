# Roadmap

Festivalapp is een schoolproject met een vaste einddatum: **woensdag 9 december 2026**. Deze roadmap beschrijft wat we tot dan bouwen, wat we bewust niet doen, en wat er na de oplevering met het project gebeurt. De gedetailleerde taken staan op het [projectbord](https://github.com/orgs/STA-NL07-Group-1/projects).

## Tot de oplevering (november – december 2026)

| Week | Periode | Doel |
| --- | --- | --- |
| 1 | 9 – 13 nov | Fundament: app- en backend-project, database, deploy naar staging, threat model |
| 2 | 16 – 20 nov | Accounts en login, timetable, eerste kaart |
| 3 | 23 – 27 nov | Kern: vrienden toevoegen via code en QR, realtime-verbinding, live kaart met pins, chat |
| 4 | 30 nov – 4 dec | MVP compleet: pushmeldingen, noodberichten, SOS-knop, instellingen, beheerportal, live drukte, chatbot, gebruikerstest |
| Afronden | 7 – 9 dec | Bugs, pentest, documentatie; release **v1.0.0** en oplevering |

### Wat we bouwen

**MVP:** accounts en login, vrienden toevoegen via code en QR, live kaart met pins, chat, timetable met updates, pushmeldingen, noodberichten, SOS-knop, instellingen (light/dark, taal) en een basis-beheerportal.

**Per specialisatie:** live drukte en aanmelden voor een show, een AI-chatbot, persoonlijke timetable en timetable van vrienden.

### Wat we niet doen

Deze onderdelen staan in de oorspronkelijke ideeënlijst, maar passen niet in de tijd. We bouwen ze alleen als er na de MVP tijd over is:

- Foto's delen met vrienden
- Spotify-koppeling voor aanbevolen acts
- Kompasmodus
- Liedje herkennen
- Spraakbediening
- Festival Wrapped
- Acts beoordelen na afloop

Bewust **buiten scope**, ook als er tijd over is:

- Native apps voor de App Store of Play Store (we bouwen alleen een PWA)
- Locatie delen op de achtergrond (kan technisch niet in een PWA op iPhone)
- Betalingen of ticketverkoop
- Gebruik op een echt festival met echte bezoekers

## Na de oplevering (vanaf 10 december 2026)

Na de oplevering stopt de actieve ontwikkeling. Voor de periode daarna geldt:

- **Geen nieuwe features.** Er worden geen nieuwe onderdelen meer gebouwd.
- **De repository blijft openbaar**, als portfolio en als voorbeeld van de werkwijze en beveiliging.
- **Beveiligingsmeldingen** via [SECURITY.md](SECURITY.md) beantwoorden we tot en met **31 maart 2027**.
- **Archiveren.** Daarna wordt de repository op GitHub gearchiveerd (alleen-lezen). Dependabot en de geplande workflows stoppen dan.

Besluit het team later toch verder te gaan, bijvoorbeeld in een vervolgproject, dan werken we deze roadmap bij via een pull request.