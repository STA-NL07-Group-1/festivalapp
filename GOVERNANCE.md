# Governance

Dit document beschrijft hoe het Festivalapp-team beslissingen neemt, wie welke rol heeft en hoe het project doorgaat als iemand uitvalt.

## Over het project

Festivalapp is een schoolproject van zes studenten (STA-NL07 Groep 1). Het project loopt tot de oplevering op **woensdag 9 december 2026**. De code is open source onder de [MIT-licentie](LICENSE).

## Hoe we beslissen

| Soort beslissing | Hoe | Voorbeeld |
| --- | --- | --- |
| **Dagelijks werk binnen je eigen onderdeel** | De eigenaar van het onderdeel beslist zelf, via een pull request met review | Hoe een scherm eruitziet, welke library je gebruikt binnen je eigen map |
| **Afspraken tussen onderdelen** | Bespreken in het team; vastleggen in `docs/` via een pull request | Wijzigingen aan `docs/api.yaml`, het datamodel |
| **Grote of teambrede keuzes** | Samen besluiten bij de wekelijkse demo of in de groepschat. Lukt het niet om eruit te komen, dan stemmen we: meerderheid beslist, bij gelijke stand beslist de projectvoorzitter | De techstack, de MVP, de planning |
| **Security** | Wijzigingen die security raken, hebben een review van Cyber Security nodig (via CODEOWNERS). Bij twijfel kiezen we de veiligste optie | Inloggen, rechten, nieuwe publieke endpoints, workflows |

Beslissingen die anderen raken, leggen we vast: in een issue, een pull request of in `docs/`. Zo kan iedereen later terugzien waarom iets zo is.

## Rollen

| Rol | Wie | Verantwoordelijk voor |
| --- | --- | --- |
| **Projectvoorzitter** | Gijs | Kick-off en demo's voorzitten, knopen doorhakken bij een gelijke stemming |
| **Network & Cloud** | Bob | Backend, hosting, realtime-verbinding, chat, pushmeldingen |
| **Network & Cloud** | Moses | Timetable-data, beheerportal, schaalbaarheid en loadtests |
| **Cyber Security** | Gijs | Login, vriendcodes, privacy, noodberichten, SOS-knop, beveiliging van repo en pipeline, het meldproces in [SECURITY.md](SECURITY.md) |
| **Software** | Niek | De app: structuur, schermen, designsysteem, timetable, instellingen |
| **IoT** | Christian | Live kaart, drukte meten, aanmelden voor shows |
| **Open Learning** | Dean | AI-chatbot, gebruikerstests en UX-onderzoek |
| **Reviewer** | Iedereen | Pull requests van anderen binnen 1 werkdag reviewen |

### Beheer van GitHub

| Rechten | Wie | Wat |
| --- | --- | --- |
| **Owner** van de organisatie | Gijs en *[tweede owner]* | Instellingen, rulesets, secrets, teamleden toevoegen of verwijderen, releases |
| **Write** (team `developers`) | Alle zes teamleden | Branches pushen, pull requests maken en reviewen, issues beheren |

## Back-up per onderdeel

Elk onderdeel heeft een tweede persoon die de code kent en het werk kan overnemen. Die persoon reviewt bij voorkeur de pull requests van dat onderdeel.

| Onderdeel | Eigenaar | Back-up |
| --- | --- | --- |
| Backend en hosting | Bob | Moses |
| Timetable-data en beheerportal | Moses | Bob |
| Security, repo en pipeline | Gijs | Bob |
| App | Niek | Christian |
| Kaart en drukte | Christian | Niek |
| Chatbot en gebruikerstests | Dean | Niek |

## Als iemand uitvalt

Het project moet binnen een week verder kunnen als iemand ziek wordt, stopt of niet meer bereikbaar is.

- **Twee owners.** De organisatie heeft altijd minimaal twee owners, zodat instellingen, secrets en teamleden altijd beheerd kunnen worden.
- **Alles staat op GitHub.** Code, taken, documentatie en beslissingen staan in de repo en op het projectbord, niet alleen op iemands laptop of in een privéchat.
- **Geen persoonlijke secrets.** API-keys en wachtwoorden voor hosting en externe diensten staan in GitHub Secrets of in de gedeelde accounts van het team, niet alleen bij één persoon. Beide owners kunnen ze vervangen.
- **Back-up neemt over.** De back-up uit de tabel hierboven neemt het onderdeel over. Het team verdeelt de taken op het projectbord opnieuw.
- **Releases.** Beide owners kunnen een release maken; de ondertekening gebeurt automatisch via GitHub Actions en hangt dus niet af van iemands persoonlijke sleutel.

Weet je dat je een tijd niet beschikbaar bent? Meld het in de groepschat en draag je openstaande issues over.

## Dit document aanpassen

Wijzigingen aan dit document gaan via een pull request en hebben de goedkeuring van een meerderheid van het team nodig.