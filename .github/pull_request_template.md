## Wat verandert er?

<!-- Kort: wat en waarom. Link het issue: "Closes #12" -->

## Hoe getest?

- [ ] `npm run lint`, `npm run typecheck` en `npm test` slagen lokaal
- [ ] Zelf geprobeerd in de app / het portal

## Security-check

- [ ] Geen geheimen of `.env` in deze PR
- [ ] Nieuwe of gewijzigde API-routes staan in `backend/api.yaml` (met rollen en rate limit waar nodig)
- [ ] Gebruikersinvoer wordt gevalideerd en nooit als HTML getoond
- [ ] Databasewijziging = nieuwe migratie (bestaande niet aangepast)
