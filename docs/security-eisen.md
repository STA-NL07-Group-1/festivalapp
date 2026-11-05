# Security: wat je wel en niet kunt verwachten

Dit document beschrijft welke beveiliging gebruikers van Festivalapp kunnen verwachten, en wat de app **niet** biedt. De app is in ontwikkeling; per eis staat of hij al is gerealiseerd.

**Status:** 📋 afgesproken (staat in [`api.yaml`](api.yaml) of het ontwerp) · 🧪 automatisch getest · ✅ gebouwd

## Wat je kunt verwachten

### Account en inloggen

| Eis | Status |
| --- | --- |
| Wachtwoorden zijn minimaal 12 en maximaal 128 tekens | 🧪 |
| Wachtwoorden worden nooit leesbaar opgeslagen, alleen als Argon2id-hash met een unieke salt | 📋 |
| Na 5 mislukte inlogpogingen binnen 15 minuten wordt inloggen tijdelijk geblokkeerd | 🧪 (afspraak in de API) |
| Een sessie verloopt na 15 minuten en wordt vernieuwd met een refresh token in een beveiligde cookie | 📋 |
| Je kunt je account en al je gegevens zelf verwijderen | 📋 |

### Vrienden en locatie

| Eis | Status |
| --- | --- |
| Je locatie delen staat standaard **uit** | 📋 |
| Alleen geaccepteerde vrienden zien je locatie, nooit andere bezoekers | 📋 |
| Je kunt per vriend instellen wie je locatie niet ziet | 📋 |
| Locaties worden na 24 uur verwijderd | 📋 |
| Vriendcodes zijn willekeurig, 8 tekens, 10 minuten geldig en één keer bruikbaar | 🧪 (formaat), 📋 (geldigheid) |
| Vriendcodes raden wordt tegengegaan met rate limiting | 🧪 (afspraak in de API) |
| ID's in de app zijn willekeurige UUID's, zodat ze niet op volgorde te raden zijn | 🧪 |

### Noodberichten en SOS

| Eis | Status |
| --- | --- |
| Noodberichten zijn ondertekend door de organisatie; de app toont alleen echte noodberichten | 📋 |
| Alleen medewerkers met de rol `organisator` kunnen berichten versturen | 🧪 (afspraak in de API) |
| SOS-meldingen zijn alleen zichtbaar voor EHBO en security | 🧪 (afspraak in de API) |
| Misbruik van de SOS-knop wordt beperkt tot 3 meldingen per 10 minuten, en de app wijst altijd op 112 | 🧪 (afspraak in de API) |

### Verbinding en data

| Eis | Status |
| --- | --- |
| Alle verkeer loopt versleuteld via HTTPS en WSS | 🧪 (alleen HTTPS-servers in de API) |
| Elk endpoint vereist inloggen, behalve een vaste lijst (registreren, inloggen, timetable, berichten van de organisatie) | 🧪 |
| Invoer wordt in de backend gecontroleerd op type, lengte en formaat | 📋 |
| Foutmeldingen bevatten geen interne details | 📋 |
| Externe diensten (zoals de AI-chatbot) krijgen geen namen of locaties van gebruikers | 📋 |

### Ontwikkeling

| Eis | Status |
| --- | --- |
| Elke wijziging wordt gereviewd door een ander teamlid | ✅ |
| Elke wijziging wordt automatisch gescand op gelekte secrets, kwetsbare code en kwetsbare packages | ✅ |
| Releases worden ondertekend, zodat je kunt controleren dat ze van ons komen | ✅ |

## Wat je niet kunt verwachten

- **Geen vervanging van 112.** De SOS-knop is voor hulp op het terrein. Bij levensgevaar bel je altijd 112.
- **Geen end-to-end-versleuteling van de chat.** Berichten zijn versleuteld onderweg (HTTPS/WSS), maar de server kan ze lezen. Deel geen gevoelige informatie via de chat.
- **Geen locatie op de achtergrond.** Je locatie wordt alleen bijgewerkt als de app open is. Een vriend kan dus op een andere plek zijn dan de kaart laat zien.
- **Geen bescherming als je telefoon niet van jou alleen is.** Wie je ontgrendelde telefoon heeft, kan de app gebruiken als jou.
- **Geen garantie op beschikbaarheid.** Op een druk festival kan het mobiele netwerk wegvallen; de app werkt dan deels offline, maar locaties, chat en meldingen niet.
- **Geen professionele audit.** Dit is een schoolproject. We testen zelf (contracttests, scans, pentest), maar er is geen onafhankelijke externe beveiligingsaudit gedaan.
- **De mock-server is niet beveiligd.** `tools/mock-server.js` is alleen voor ontwikkeling op je eigen computer en accepteert elk token.

## Een probleem gevonden?

Meld beveiligingsproblemen privé, zoals beschreven in [SECURITY.md](../SECURITY.md).