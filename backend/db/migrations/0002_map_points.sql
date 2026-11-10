-- =============================================================================
-- Festivalapp — migratie 0002: kaartpunten
-- PostgreSQL 16+
--
-- Punten die de organisatie zelf op de kaart zet: wifi, EHBO, water, ingang,
-- oplaadpunten enzovoort. De app bewaart ze op de telefoon, zodat ze ook
-- zonder internet zichtbaar blijven.
-- Er is nog geen festival_id: die komt mee met de migratie voor meerdere festivals.
-- =============================================================================

BEGIN;

CREATE TYPE map_point_kind AS ENUM (
    'wifi', 'ehbo', 'water', 'toilet', 'ingang', 'uitgang',
    'eten', 'activiteit', 'oplaadpunt', 'info'
);

CREATE TABLE map_points (
    id           uuid             PRIMARY KEY DEFAULT gen_random_uuid(),
    kind         map_point_kind   NOT NULL,
    name         text             NOT NULL,
    description  text,
    latitude     double precision NOT NULL,
    longitude    double precision NOT NULL,
    created_by   uuid             REFERENCES users(id) ON DELETE SET NULL,
    created_at   timestamptz      NOT NULL DEFAULT now(),
    updated_at   timestamptz      NOT NULL DEFAULT now(),
    CONSTRAINT map_points_name_length        CHECK (char_length(name) BETWEEN 1 AND 60),
    CONSTRAINT map_points_description_length CHECK (description IS NULL OR char_length(description) <= 200),
    CONSTRAINT map_points_lat_range          CHECK (latitude  BETWEEN -90  AND 90),
    CONSTRAINT map_points_lng_range          CHECK (longitude BETWEEN -180 AND 180)
);
CREATE INDEX map_points_kind_idx ON map_points (kind);

CREATE TRIGGER map_points_set_updated_at
    BEFORE UPDATE ON map_points
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMIT;
