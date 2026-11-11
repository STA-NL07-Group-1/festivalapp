-- =============================================================================
-- Festivalapp — migratie 0003: accounts blokkeren
-- PostgreSQL 16+
--
-- Een beheerder kan een bezoeker blokkeren (bijvoorbeeld na een incident).
-- Een geblokkeerd account kan niet meer inloggen. We bewaren alleen een korte,
-- neutrale reden: geen details over het incident (dataminimalisatie).
-- Nu geldt een blokkade voor de hele installatie; het verschil tussen "dit
-- festival" en "alle festivals" komt mee met de migratie voor meerdere festivals.
-- =============================================================================

BEGIN;

ALTER TABLE users
    ADD COLUMN blocked_at     timestamptz,
    ADD COLUMN blocked_reason text,
    ADD CONSTRAINT users_blocked_reason_length CHECK (blocked_reason IS NULL OR char_length(blocked_reason) BETWEEN 1 AND 200),
    -- geblokkeerd = altijd met reden; niet geblokkeerd = geen reden
    ADD CONSTRAINT users_blocked_has_reason    CHECK ((blocked_at IS NULL) = (blocked_reason IS NULL));

COMMIT;
