# Assurance case

Dit document onderbouwt waarom we erop vertrouwen dat Festivalapp veilig genoeg is voor zijn doel: bezoekers van een festival elkaar laten vinden en de organisatie snel laten communiceren, zonder dat locaties, berichten of accounts in verkeerde handen vallen.

De onderbouwing bestaat uit vier delen:

1. **[Threat model](#1-threat-model):** wat kan er misgaan, en wat doen we ertegen?
2. **[Vertrouwensgrenzen](#2-vertrouwensgrenzen):** waar komt data binnen die we niet vertrouwen?
3. **[Secure design](#3-secure-design):** welke ontwerpprincipes passen we toe?
4. **[Bekende zwakheden](#4-bekende-zwakheden-owasp-top-102025):** hoe gaan we de OWASP Top 10 tegen?

Eigenaar: Cyber Security (Gijs). Het document wordt bijgewerkt bij elke wijziging die de beveiliging raakt, en na de pentest in de laatste week.

**Status van een maatregel:** 📋 afgesproken (in [`api.yaml`](api.yaml) of het ontwerp) · 🧪 automatisch getest · ✅ gebouwd en in gebruik

---

## 1. Threat model

We gebruiken de **STRIDE**-methode: per onderdeel kijken we naar **S**poofing (je voordoen als een ander), **T**ampering (gegevens aanpassen), **R**epudiation (ontkennen dat je iets deed), **I**nformation disclosure (gegevens lekken), **D**enial of service (onbruikbaar maken) en **E**levation of privilege (meer rechten krijgen dan je hebt).

**Kans** en **impact** zijn Laag, Middel of Hoog. Het **risico** is de combinatie; Hoog risico pakken we als eerste aan.

### Wat we beschermen

| Bezit | Waarom gevoelig |
| --- | --- |
| Locatie van bezoekers | Kan misbruikt worden om iemand te volgen (stalking) |
| Accounts | Wie een account overneemt, ziet de locatie en berichten van die persoon |
| Vriendschappen | Bepalen wie elkaars locatie ziet |
| Chatberichten | Privégesprekken |
| Noodberichten | Een vals noodbericht kan paniek veroorzaken op een vol terrein |
| SOS-meldingen | Moeten aankomen; misbruik houdt EHBO van echte noodgevallen af |
| Beheerportal | Hiermee verstuur je noodberichten en zie je SOS-meldingen |
| Code en pipeline | Een aanvaller in de pipeline kan kwaadaardige code in de app krijgen |

### Dreigingen

| ID | Dreiging | STRIDE | Kans | Impact | Maatregelen | Status |
| --- | --- | --- | --- | --- | --- | --- |
| **T1** | Iemand ziet de locatie van een bezoeker die geen vriend is | I | Middel | Hoog | Locaties alleen voor geaccepteerde vrienden; de backend controleert de vriendschap bij elk verzoek; locatie delen staat standaard uit | 📋 |
| **T2** | Iemand raadt of onderschept een vriendcode en wordt ongevraagd "vriend" | S, E | Middel | Hoog | Willekeurige code van 8 tekens (32⁸ ≈ 10¹² mogelijkheden), 10 minuten geldig, één keer bruikbaar, rate limiting; ongeldige en verlopen codes geven dezelfde foutmelding | 🧪 formaat en rate limiting in de API, 📋 geldigheid |
| **T3** | Iemand neemt een account over door wachtwoorden te raden | S | Middel | Hoog | Minimaal 12 tekens, lockout na 5 pogingen per 15 minuten | 🧪 in de API |
| **T4** | Wachtwoorden lekken na een inbraak in de database | I | Laag | Hoog | Argon2id met unieke salt; nooit leesbaar opgeslagen | 📋 |
| **T5** | Een gestolen token wordt hergebruikt | S | Laag | Middel | Access token geldig 15 minuten; refresh token in een httpOnly-cookie, in te trekken bij uitloggen | 📋 |
| **T6** | Een vals noodbericht veroorzaakt paniek | S, T | Laag | Hoog | Alleen de rol `organisator` kan berichten versturen; noodberichten worden ondertekend en de app controleert de handtekening | 🧪 rol in de API, 📋 handtekening |
| **T7** | Iemand krijgt toegang tot het beheerportal | E | Laag | Hoog | Rollen worden in de backend gecontroleerd, niet alleen in het portal; elke beheer-endpoint geeft 403 zonder rol | 🧪 in de API |
| **T8** | Iemand spamt de SOS-knop | D | Middel | Middel | Maximaal 3 meldingen per 10 minuten per gebruiker; melding bevat account en locatie | 🧪 in de API |
| **T9** | Iemand leest chatberichten van anderen | I | Laag | Middel | Alleen chatten met vrienden; backend controleert dat je deelnemer bent; versleuteld onderweg (HTTPS/WSS). **Geen** end-to-end-versleuteling: de server kan berichten lezen | 📋 |
| **T10** | Kwaadaardige invoer (XSS, injectie) in chat, namen of pins | T, E | Middel | Hoog | Invoer gevalideerd tegen de allowlist in `api.yaml`; React escapet tekst; ESLint blokkeert `innerHTML` en `dangerouslySetInnerHTML`; geparametriseerde SQL-queries | 🧪 ESLint en validatie in de mock, 📋 backend |
| **T11** | ID's raden om gegevens van anderen op te vragen (IDOR) | I | Middel | Hoog | Alle ID's zijn willekeurige UUID's; de backend controleert eigendom bij elk verzoek | 🧪 UUID's in de API, 📋 controle |
| **T12** | De server wordt overspoeld met verzoeken | D | Middel | Middel | Rate limiting, maximale lengte op velden en request bodies | 🧪 in de API, ✅ in de mock-server |
| **T13** | Een gecompromitteerde npm-package of GitHub Action komt in de app of pipeline | T, E | Middel | Hoog | Dependency Review, Dependabot met 7 dagen wachttijd, actions vastgezet op een commit-SHA, Harden-Runner blokkeert onbekend uitgaand verkeer, `npm ci --ignore-scripts` | ✅ |
| **T14** | Een API-key of wachtwoord komt in de repo | I | Middel | Hoog | `.env` in `.gitignore`, Gitleaks vóór elke commit, TruffleHog in de CI, GitHub push protection | ✅ |
| **T15** | Iemand zet ongemerkt code op `main` | T | Laag | Hoog | Ruleset: pull request verplicht, 2 goedkeuringen (1 voor owners), alle checks groen, ondertekende commits | ✅ |
| **T16** | Iemand ontkent een beheeractie, zoals het versturen van een noodbericht | R | Laag | Middel | Elke beheeractie wordt gelogd met wie, wat en wanneer | 📋 |
| **T17** | Een release wordt onderweg vervangen door een aangepaste versie | T | Laag | Middel | Releases ondertekend met Sigstore; controle met `cosign verify-blob` (zie [SECURITY.md](../SECURITY.md)) | ✅ |

## 2. Vertrouwensgrenzen

De onderdelen en de grenzen ertussen staan in [`architectuur.md`](architectuur.md#vertrouwensgrenzen). Samengevat:

| Grens | Wat we niet vertrouwen | Hoe we het controleren |
| --- | --- | --- |
| Telefoon → backend | Alles wat de app stuurt | Inloggen, rechten per verzoek, validatie tegen `api.yaml` |
| Portal → backend | Of de gebruiker echt een beheerrol heeft | Rolcontrole in de backend |
| Backend → externe diensten | Wat we naar buiten sturen | Alleen het nodige; geen namen of locaties naar de AI-dienst |
| Drukte-meting → backend | Of de meting van een echt apparaat komt | Eigen apparaat-token |
| Bijdrager → repository | Of een wijziging veilig is | Review, ondertekende commits, automatische scans |

## 3. Secure design

We passen de ontwerpprincipes van Saltzer en Schroeder toe:

| Principe | Hoe we het toepassen |
| --- | --- |
| **Veilige standaard** (fail-safe defaults) | Inloggen is standaard verplicht voor elk endpoint (een contracttest bewaakt dat alleen 5 endpoints publiek zijn); locatie delen staat standaard uit |
| **Minimale rechten** (least privilege) | Workflows hebben standaard alleen leesrechten; leden van de organisatie hebben standaard Read; beheerrollen alleen voor wie ze nodig heeft |
| **Volledige controle** (complete mediation) | De backend controleert bij elk verzoek wie je bent en of je de gegevens mag zien, ook als de app dat al deed |
| **Scheiding van rechten** (separation of privilege) | Een wijziging op `main` vereist een andere persoon die goedkeurt; security-gevoelige mappen vereisen Cyber Security (CODEOWNERS) |
| **Eenvoud** (economy of mechanism) | Bestaande, beproefde oplossingen: Argon2id, JWT, TLS; geen eigen cryptografie |
| **Open ontwerp** (open design) | De code en dit document zijn openbaar; de beveiliging hangt niet af van geheimhouding van het ontwerp, alleen van de sleutels |
| **Psychologische aanvaardbaarheid** | Veilig is ook makkelijk: de hooks voor secrets en sign-off werken automatisch; vriendcodes zijn kort en zonder verwarrende tekens |

## 4. Bekende zwakheden (OWASP Top 10:2025)

| OWASP-categorie | Hoe we het tegengaan | Dreigingen |
| --- | --- | --- |
| **A01 Broken Access Control** | Inloggen standaard verplicht, vriendschap en eigendom gecontroleerd per verzoek, UUID's, rollen in de backend | T1, T7, T9, T11 |
| **A02 Security Misconfiguration** | Alleen HTTPS, CORS met een vaste allowlist, foutmeldingen zonder interne details, security-headers (CSP, HSTS) bij de deployment | T10 |
| **A03 Software Supply Chain Failures** | Dependency Review, Dependabot met wachttijd, vastgezette actions, Harden-Runner, SBOM, ondertekende releases, OpenSSF Scorecard | T13, T17 |
| **A04 Cryptographic Failures** | TLS 1.2/1.3, Argon2id, geen zwakke algoritmen, geen eigen cryptografie, secrets buiten de code | T4, T14 |
| **A05 Injection** | Validatie tegen `api.yaml`, geparametriseerde SQL-queries, React escapet uitvoer, ESLint en Semgrep | T10 |
| **A06 Insecure Design** | Dit threat model, security-eisen per feature, contracttests op de API-afspraken | alle |
| **A07 Authentication Failures** | Wachtwoordeisen, lockout, kortlevende tokens, intrekbare refresh tokens | T3, T5 |
| **A08 Software or Data Integrity Failures** | Ondertekende noodberichten, ondertekende commits en releases, review vóór merge | T6, T15, T17 |
| **A09 Security Logging and Alerting Failures** | Logging van beheeracties en mislukte logins, zonder wachtwoorden of tokens in de logs | T3, T16 |
| **A10 Mishandling of Exceptional Conditions** | Ongeldige invoer en ongeldige JSON geven een nette 400; maximale grootte van verzoeken; foutmeldingen zonder stacktraces | T10, T12 |

## Open punten

Wat nog niet gebouwd of getest is, en wanneer we het afronden:

| Punt | Wanneer | Wie |
| --- | --- | --- |
| Rechtencontrole per verzoek in de backend (T1, T7, T9, T11) | Week 2–3 | Bob, Gijs |
| Argon2id en tokens bij login (T3, T4, T5) | Week 2 | Gijs, Bob |
| Geldigheid van vriendcodes (T2) | Week 3 | Gijs |
| Ondertekening van noodberichten (T6) | Week 4 | Gijs, Moses |
| Logging van beheeracties en mislukte logins (T16, A09) | Week 4 | Bob, Moses |
| Security-headers bij de deployment (A02) | Week 4 | Bob |
| Pentest en dynamische scan met OWASP ZAP op staging | Afronden | Gijs |

Na de pentest werken we de status in dit document bij.