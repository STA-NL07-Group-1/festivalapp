-- =============================================================================
-- Festivalapp — migratie 0007: chat bij slecht bereik en meldingsvoorkeuren
-- PostgreSQL 16+
--
--   * messages.client_id    id dat de app zelf aan een bericht geeft. Wordt een bericht bij
--                           slecht bereik opnieuw verstuurd, dan herkent de server het en
--                           slaat hij het geen tweede keer op.
--   * users.notify_*        welke pushmeldingen iemand wil. Noodberichten gaan altijd door,
--                           daar is bewust geen kolom voor.
-- =============================================================================

BEGIN;

ALTER TABLE messages ADD COLUMN client_id uuid;
-- Uniek per afzender: twee mensen mogen toevallig hetzelfde id kiezen, één persoon niet twee keer
CREATE UNIQUE INDEX messages_sender_client_idx ON messages (sender_id, client_id) WHERE client_id IS NOT NULL;

ALTER TABLE users ADD COLUMN notify_chat boolean NOT NULL DEFAULT true;
ALTER TABLE users ADD COLUMN notify_timetable boolean NOT NULL DEFAULT true;
ALTER TABLE users ADD COLUMN notify_announcements boolean NOT NULL DEFAULT true;

COMMIT;
