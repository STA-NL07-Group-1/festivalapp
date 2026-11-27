-- =============================================================================
-- Festivalapp — migratie 0012: gesprekken dempen voor een tijdje
-- PostgreSQL 16+
--
-- Een groep of een gesprek met een vriend kun je dempen voor 1 uur, 24 uur of altijd. Gedempt = geen
-- pushmelding van dat gesprek; berichten komen gewoon binnen en tellen mee als ongelezen.
--  - group_members.muted (aan/uit, uit 0008) wordt muted_until: tot wanneer de groep gedempt is.
--    Altijd dempen = 9999-12-31 (zie src/mutes.ts). NULL = niet gedempt. Een tijdstip in het verleden = niet meer gedempt.
--  - chat_mutes: hetzelfde voor een gesprek met een vriend. Eén rij per persoon per vriend.
-- =============================================================================

BEGIN;

ALTER TABLE group_members ADD COLUMN muted_until timestamptz;
UPDATE group_members SET muted_until = '9999-12-31T00:00:00Z' WHERE muted;
ALTER TABLE group_members DROP COLUMN muted;

CREATE TABLE chat_mutes (
    user_id      uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    -- het gesprek met deze vriend is gedempt (alleen voor user_id, niet voor de vriend)
    friend_id    uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    muted_until  timestamptz NOT NULL,
    PRIMARY KEY (user_id, friend_id),
    CONSTRAINT chat_mutes_not_self CHECK (user_id <> friend_id)
);

COMMIT;
