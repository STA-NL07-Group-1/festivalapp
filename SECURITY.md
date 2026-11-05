# Security

## Een kwetsbaarheid melden

Heb je een beveiligingsprobleem gevonden in Festivalapp? **Maak geen openbaar issue aan.**

Meld het privé via GitHub: ga naar het tabblad **Security** en klik op **Report a vulnerability**, of gebruik direct deze link:
https://github.com/STA-NL07-Group-1/festivalapp/security/advisories/new

Alleen het team ziet je melding.

### Wat we graag van je horen

- Welk onderdeel het betreft (app, backend, beheerportal, workflows)
- Hoe je het probleem kunt nadoen, stap voor stap
- Wat iemand ermee zou kunnen doen (bijvoorbeeld locaties van anderen zien)
- Of je het al ergens anders hebt gemeld

### Wat je van ons kunt verwachten

| Stap | Termijn |
| --- | --- |
| Bevestiging dat we je melding hebben ontvangen | binnen 3 werkdagen |
| Eerste inschatting van de ernst | binnen 7 werkdagen |
| Oplossing voor een ernstig probleem | zo snel mogelijk, uiterlijk binnen 30 dagen |

We houden je op de hoogte en vermelden je naam bij de oplossing, als je dat wilt. We vragen je het probleem niet openbaar te maken voordat het is opgelost (coordinated disclosure).

## Ondersteunde versies

Het project is in ontwikkeling. Alleen de nieuwste versie op `main` krijgt beveiligingsupdates.

## Scope

Binnen scope: de code in deze repository en de staging-omgeving van het team.
Buiten scope: diensten van derden (zoals GitHub, Spotify of hostingproviders), en aanvallen die fysieke toegang tot een telefoon vereisen.

Test nooit op de gegevens of accounts van andere gebruikers.

## Een release controleren

Elke release wordt automatisch ondertekend met [Sigstore](https://www.sigstore.dev) door de workflow `release-sign.yml`. Bij de release staan het bronarchief (`festivalapp-vX.Y.Z.tar.gz`) en de handtekening (`festivalapp-vX.Y.Z.tar.gz.sigstore.json`).

Controleer met [cosign](https://docs.sigstore.dev/cosign/system_config/installation/) dat het archief van ons komt en niet is aangepast:

```bash
cosign verify-blob festivalapp-v0.0.2.tar.gz \
  --bundle festivalapp-v0.0.2.tar.gz.sigstore.json \
  --certificate-identity "https://github.com/STA-NL07-Group-1/festivalapp/.github/workflows/release-sign.yml@refs/tags/v0.0.2" \
  --certificate-oidc-issuer "https://token.actions.githubusercontent.com"
```

Vervang `v0.0.2` door de versie die je controleert. `Verified OK` betekent dat het archief echt door onze workflow is gemaakt.


---

## English

**Reporting a vulnerability:** please do not open a public issue. Report security vulnerabilities privately through GitHub's private vulnerability reporting: https://github.com/STA-NL07-Group-1/festivalapp/security/advisories/new

We acknowledge reports within 3 business days and aim to fix critical vulnerabilities within 30 days. We follow coordinated disclosure: please give us the chance to fix the issue before disclosing it publicly. Only the latest version on `main` receives security updates.
