-- =============================================================================
-- Festivalapp — migratie 0011: ook video's delen (in de chat en in het album)
-- PostgreSQL 16+
--
-- De tabel heet nog `photos`, maar bevat nu foto's én video's ("media"). Maximaal 25 MB per bestand
-- (die grens stond al in 0008). Een chatbericht met een video heeft kind = 'foto', net als een foto:
-- het type staat bij het bestand zelf (content_type), zo hoeft het enum message_kind niet te veranderen.
-- =============================================================================

BEGIN;

ALTER TABLE photos DROP CONSTRAINT photos_type;
ALTER TABLE photos ADD CONSTRAINT photos_type CHECK (content_type IN (
    'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/avif',
    'image/heic', 'image/heif', 'image/bmp', 'image/tiff',
    'video/mp4', 'video/quicktime', 'video/webm'
));

COMMIT;
