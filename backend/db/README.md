# Database

Het datamodel van de Festivalapp voor PostgreSQL. Eigenaar: Bob, back-up: Moses.

| Bestand | Inhoud |
| --- | --- |
| `migrations/0001_init.sql` | Eerste schema met de tabellen voor de MVP |
| `schema.dbml` | Hetzelfde model voor [dbdiagram.io](https://dbdiagram.io/d) |
| `constraints-test.sql` | Handmatige test van de regels in de database |

## Migratie uitvoeren

Zet de verbinding in `DATABASE_URL` in je `.env` en voer de migraties op volgorde uit:

```bash
psql "$DATABASE_URL" -f backend/db/migrations/0001_init.sql
```

Pas een migratie die al is samengevoegd niet meer aan. Maak een nieuw bestand met het volgende nummer, bijvoorbeeld `0002_foto_s.sql`.

## Regels

- ID's zijn UUID's, omdat ze in URL's staan en niet te raden mogen zijn.
- Waarden en lengtes volgen `docs/api.yaml`. `tests/database-schema.test.js` bewaakt dit.
- Wachtwoorden, refresh tokens, vriendcodes en ticketlinks staan alleen als hash in de database.
- Per gebruiker staat alleen de laatste locatie in de database. De backend verwijdert die na 24 uur of na het festival.
- Kaart en chat gebruiken de view `active_friendships`, omdat vrienden alleen actief zijn op hetzelfde festival.

De backend controleert daarnaast altijd zelf wie iets mag zien. De database kan dat niet alleen.
