-- =============================================================================
-- Festivalapp — migratie 0009: herinnering vlak voor een optreden
-- PostgreSQL 16+
--
-- 15 minuten voor een act krijg je een pushmelding als die in je timetable staat of als je je
-- ervoor hebt aangemeld (zie backend/src/reminders.ts). reminded_at onthoudt dat de herinnering
-- al verstuurd is, zodat niemand er twee krijgt. Wordt een optreden naar een andere tijd
-- verplaatst, dan zet de backend reminded_at weer op NULL.
-- =============================================================================

BEGIN;

ALTER TABLE timetable_entries ADD COLUMN reminded_at timestamptz;
ALTER TABLE show_signups      ADD COLUMN reminded_at timestamptz;

COMMIT;
