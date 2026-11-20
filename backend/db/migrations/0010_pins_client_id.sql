-- =============================================================================
-- Festivalapp — migratie 0010: pins zonder bereik
-- PostgreSQL 16+
--
-- Een pin die je zonder bereik plaatst, wacht in de app (lib/outbox.ts) en gaat later alsnog.
-- Net als bij chatberichten (0007) heeft hij een eigen id van de app: komt dezelfde pin door
-- een nieuwe poging twee keer binnen, dan slaat de server hem maar één keer op.
-- =============================================================================

BEGIN;

ALTER TABLE pins ADD COLUMN client_id uuid;
CREATE UNIQUE INDEX pins_user_client_idx ON pins (user_id, client_id) WHERE client_id IS NOT NULL;

COMMIT;
