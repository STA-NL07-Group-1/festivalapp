# Handleiding Festivalapp

> **Let op:** de app is in ontwikkeling. Bij elk onderdeel staat of het al werkt. Onderdelen met 🚧 zijn nog niet gebouwd; de tekst daar beschrijft hoe het gaat werken en wordt bijgewerkt zodra het onderdeel af is.

## Status per onderdeel

| Onderdeel | Status | Gepland | Bijgewerkt door |
| --- | --- | --- | --- |
| [App installeren](#app-installeren) | 🚧 In ontwikkeling | Week 2 | Niek |
| [Account en inloggen](#account-en-inloggen) | 🚧 In ontwikkeling | Week 2 | Gijs, Niek |
| [Vrienden toevoegen](#vrienden-toevoegen) | 🚧 In ontwikkeling | Week 3 | Gijs, Niek |
| [Live kaart en pins](#live-kaart-en-pins) | 🚧 In ontwikkeling | Week 3 | Christian |
| [Locatie delen en privacy](#locatie-delen-en-privacy) | 🚧 In ontwikkeling | Week 3 | Gijs |
| [Chat](#chat) | 🚧 In ontwikkeling | Week 3 | Niek, Bob |
| [Timetable](#timetable) | 🚧 In ontwikkeling | Week 2–4 | Niek, Moses |
| [Meldingen en noodberichten](#meldingen-en-noodberichten) | 🚧 In ontwikkeling | Week 4 | Bob, Moses |
| [SOS-knop](#sos-knop) | 🚧 In ontwikkeling | Week 4 | Gijs |
| [Live drukte](#live-drukte) | 🚧 In ontwikkeling | Week 4 | Christian |
| [Festival-assistent (chatbot)](#festival-assistent-chatbot) | 🚧 In ontwikkeling | Week 4 | Dean |
| [Instellingen](#instellingen) | 🚧 In ontwikkeling | Week 4 | Niek |
| [Beheerportal](#beheerportal-voor-de-organisatie) | 🚧 In ontwikkeling | Week 2–4 | Moses |

Is een onderdeel af? Zet de status op ✅ **Werkt**, controleer of de tekst klopt met wat er gebouwd is, en voeg een screenshot toe in `docs/img/`.

---

## App installeren

🚧 *In ontwikkeling*

Festivalapp is een web-app die je op je beginscherm zet. Je hebt geen App Store of Play Store nodig.

**iPhone (Safari)**

1. Open de app in **Safari**. Andere browsers op de iPhone kunnen hem niet installeren.
2. Tik onderin op het **deel-icoon** (vierkant met pijl omhoog).
3. Kies **Zet op beginscherm** en tik op **Voeg toe**.
4. Open de app voortaan via het icoon op je beginscherm. Alleen dan werken meldingen.

**Android (Chrome)**

1. Open de app in **Chrome**.
2. Tik op de melding **App installeren**, of open het menu (⋮) en kies **App installeren**.
3. Tik op **Installeren**.

**Toestemmingen**

De app vraagt om toestemming wanneer je een functie voor het eerst gebruikt:

| Toestemming | Waarvoor | Zonder toestemming |
| --- | --- | --- |
| Locatie | Je positie op de kaart en voor vrienden | Kaart werkt, maar zonder jouw positie |
| Camera | QR-code van een vriend scannen | Je kunt de code ook intypen |
| Meldingen | Updates, noodberichten, berichten van vrienden | Je ziet updates alleen als de app open is |

Je kunt dit later altijd aanpassen in de instellingen van je telefoon.

## Account en inloggen

🚧 *In ontwikkeling*

1. Tik op **Account maken** en vul je e-mailadres, een naam en een wachtwoord in.
2. Je wachtwoord moet minimaal **12 tekens** hebben. Tip: gebruik een zin, zoals `zonnig-festival-2026`.
3. Na vijf keer een verkeerd wachtwoord moet je 15 minuten wachten voordat je opnieuw kunt proberen.

**Account verwijderen:** ga naar **Instellingen** → **Account** → **Account verwijderen**. Al je gegevens worden dan gewist: je vrienden, berichten, locaties en timetable.

## Vrienden toevoegen

🚧 *In ontwikkeling*

Vrienden toevoegen gaat altijd met een tijdelijke code, zodat niemand je zomaar kan vinden.

**Jij nodigt uit**

1. Ga naar **Vrienden** → **Vriend toevoegen** → **Mijn code**.
2. Je ziet een **QR-code** en een code van 8 tekens, zoals `K7P3XQ9M`.
3. Laat je vriend de QR-code scannen of geef de code door. De code werkt **10 minuten** en maar **één keer**.

**Jij voegt toe**

1. Ga naar **Vrienden** → **Vriend toevoegen** → **Code scannen**, en scan de QR-code van je vriend.
2. Of kies **Code invoeren** en typ de 8 tekens in.

**Vriend verwijderen:** open de vriend en tik op **Verwijderen**. Jullie zien daarna elkaars locatie en timetable niet meer.

## Live kaart en pins

🚧 *In ontwikkeling*

De kaart toont het festivalterrein, je eigen positie en die van vrienden die hun locatie met je delen.

- Bij elke vriend staat **"laatst gezien om …"**. Een vriend die de app niet open heeft, wordt niet bijgewerkt.
- **Pin droppen:** houd je vinger op de kaart, geef de pin een naam (bijvoorbeeld *Ontmoetingsplek*) en kies of je vrienden hem mogen zien.
- Alle locaties staan ook als **lijst** onder de kaart, met afstand en richting. Handig als de kaart moeilijk te lezen is.

## Locatie delen en privacy

🚧 *In ontwikkeling*

- Je locatie delen staat standaard **uit**. Je zet het zelf aan bij **Instellingen** → **Locatie delen**.
- Je kunt per vriend kiezen wie je locatie **niet** mag zien.
- Alleen vrienden zien je locatie, nooit andere bezoekers.
- Locaties worden na **24 uur** automatisch verwijderd.
- Je locatie wordt alleen bijgewerkt terwijl de app open is.

## Chat

🚧 *In ontwikkeling*

Open een vriend en tik op **Chat**. Berichten zijn maximaal 1000 tekens. Je kunt alleen chatten met vrienden.

## Timetable

🚧 *In ontwikkeling*

- **Timetable:** alle optredens per podium en per dag.
- **Mijn timetable:** tik bij een optreden op het **sterretje** om het toe te voegen.
- **Timetable van vrienden:** open een vriend om te zien naar welke optredens die gaat.
- Verandert er iets, zoals een optreden dat verplaatst of afgelast wordt, dan zie je dat direct en krijg je een melding als het in jouw timetable staat.

## Meldingen en noodberichten

🚧 *In ontwikkeling*

De organisatie stuurt berichten via de app:

| Soort | Voorbeeld |
| --- | --- |
| Info | Waterpunten bij de Mainstage zijn open |
| Update | Act X begint 30 minuten later |
| **Noodbericht** | Verlaat het terrein via uitgang Noord |

Een **noodbericht** herken je aan de rode balk bovenin. De app controleert of het echt van de organisatie komt; berichten die dat niet zijn, worden niet getoond. Volg bij een noodbericht altijd de aanwijzingen van het personeel ter plaatse.

## SOS-knop

🚧 *In ontwikkeling*

> **Bij levensgevaar: bel altijd direct 112.**

De SOS-knop is voor situaties waarin je hulp nodig hebt van EHBO of security op het terrein.

1. Tik op de rode **SOS**-knop, die op elk scherm te vinden is.
2. Kies **Medisch**, **Veiligheid** of **Anders**, en voeg eventueel een korte toelichting toe.
3. Tik op **Versturen**. Je locatie wordt meegestuurd.
4. Je ziet de status: *Ontvangen* → *Hulp onderweg* → *Afgehandeld*.

Je kunt maximaal 3 SOS-meldingen per 10 minuten versturen. Het scherm toont daarnaast altijd een knop om **112** te bellen.

## Live drukte

🚧 *In ontwikkeling*

Op de kaart zie je per podium hoe druk het is: **rustig**, **gemiddeld** of **druk**. Bij een optreden kun je je aanmelden, zodat je ziet hoeveel mensen er van plan zijn te komen.

*Hoe de drukte gemeten wordt, beschrijft Christian hier zodra de meetmethode gekozen is.*

## Festival-assistent (chatbot)

🚧 *In ontwikkeling*

Stel vragen over het festival, zoals *"Waar is de dichtstbijzijnde wc?"* of *"Wanneer speelt act X?"*. De assistent geeft antwoord op basis van de timetable en de informatie van de organisatie.

*Dean vult hier aan welke vragen de assistent kan beantwoorden, en wat er met je vragen gebeurt (privacy).*

## Instellingen

🚧 *In ontwikkeling*

- **Weergave:** licht, donker of volgens je telefoon
- **Taal:** Nederlands of Engels
- **Locatie delen:** aan of uit, en per vriend
- **Meldingen:** per soort aan of uit; noodberichten kun je niet uitzetten
- **Account:** uitloggen of account verwijderen

## Beheerportal voor de organisatie

🚧 *In ontwikkeling*

Het beheerportal is een aparte website voor de organisatie. Alleen medewerkers met een rol kunnen inloggen:

| Rol | Kan |
| --- | --- |
| Organisator | Timetable beheren, berichten en noodberichten versturen |
| EHBO | SOS-meldingen zien en afhandelen |
| Security | SOS-meldingen zien en afhandelen |

*Moses beschrijft hier per scherm hoe het portal werkt.*

---

## Hulp en problemen

- **Iets werkt niet?** Meld het via een [issue](https://github.com/STA-NL07-Group-1/festivalapp/issues/new/choose) met de template **Bug melden**.
- **Toegankelijkheidsprobleem?** Zie [ACCESSIBILITY.md](../ACCESSIBILITY.md).
- **Beveiligingsprobleem?** Meld het privé, zie [SECURITY.md](../SECURITY.md).