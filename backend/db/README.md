# Database

PostgreSQL 16 of nieuwer. Eigenaar: **Bob** (Network & Cloud), review op security door **Gijs**.

## Bestanden

| Bestand | Wat |
|---|---|
| `migrations/0001_init.sql` | Eerste schema: 17 tabellen, enums, constraints, triggers. **Bron van waarheid.** |
| `schema.dbml` | Hetzelfde schema als diagram. Plak het in [dbdiagram.io](https://dbdiagram.io). |
| `constraints-test.sql` | Probeert 36 ongeldige dingen op te slaan en controleert dat de database ze weigert. |
| `create-test-db.sql` | Maakt `festivalapp_test` aan als je `docker compose up` gebruikt. |

## De 21 tabellen

| Groep | Tabellen |
|---|---|
| Festivals en rollen | `festivals`, `festival_members`, `festival_blocks` |
| Accounts | `tickets`, `users`, `sessions` |
| Sociaal | `friend_codes`, `friendships`, `locations`, `pins`, `messages` |
| Programma | `stages`, `performances`, `timetable_entries`, `show_signups`, `crowd_readings` |
| Organisatie | `push_subscriptions`, `announcements`, `sos_alerts`, `map_points`, `audit_log` |

Sinds migratie 0004 kunnen er meerdere festivals in één installatie staan. Podia, mededelingen,
SOS-meldingen, kaartpunten, tickets, locaties en pins hebben een `festival_id`; optredens en drukte
horen via hun podium bij een festival. Vrienden en chats horen bij het account en niet bij een festival.

Rollen staan niet meer in `users`. Wie in `festival_members` staat is personeel van dat festival
(`beheerder`, `organisatie`, `ehbo` of `beveiliging`); wie alleen een ticket heeft is bezoeker.
`users.platform_role` is voor de twee rollen over alle festivals heen: `eigenaar` en `sudo`.

Daarnaast houdt `npm run db:migrate` in de tabel `schema_migrations` bij welke migraties al gedraaid zijn.

## Lokaal draaien

```bash
# Database starten (of gebruik je eigen PostgreSQL)
docker compose up -d

# Migraties uitvoeren en demo-data laden
npm run db:migrate
npm run db:seed

# Constraints controleren (draait in een transactie en laat niets achter)
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f backend/db/constraints-test.sql
```

## Afspraken

- **Nooit een bestaande migratie aanpassen** nadat die op `main` staat. Maak een nieuwe:
  `0002_<korte_omschrijving>.sql`. Elke migratie staat in een `BEGIN; … COMMIT;`.
- **Geheimen alleen als hash.** Wachtwoorden met argon2id; refresh-tokens, ticketcodes,
  vriendcodes en IoT-sleutels met SHA-256 (het zijn lange willekeurige waarden).
- **Dataminimalisatie.** `locations` heeft één rij per gebruiker en verloopt binnen een uur.
  De backend verwijdert verlopen rijen elke minuut (`DELETE FROM locations WHERE expires_at < now()`).
  Na het festival worden `messages`, `locations`, `pins` en `sos_alerts` gewist (zie
  `docs/security-eisen.md`).
- **Integriteit in de database.** Wat de database kan afdwingen (bereik, uniek, volgorde),
  doen we met een constraint — de API controleert het daarnaast nog een keer.
- **`audit_log` is append-only.** Een trigger weigert `UPDATE` en `DELETE`. De applicatie-
  gebruiker krijgt in productie bovendien alleen `INSERT`- en `SELECT`-rechten op deze tabel.
- Pas je het schema aan, werk dan ook `schema.dbml` en `backend/api.yaml` bij.
  CODEOWNERS vraagt automatisch om review.
