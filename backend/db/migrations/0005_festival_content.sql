-- =============================================================================
-- Festivalapp — migratie 0005: informatie per festival
-- PostgreSQL 16+
--
-- Wat de organisatie per festival in het portal invult en bezoekers in de app zien:
--   * festivals.house_rules_*  huisregels (Nederlands en Engels)
--   * faq_items                veelgestelde vragen
--   * site_maps                plattegrond (afbeelding van het festival zelf)
--   * lost_items               gevonden voorwerpen
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- huisregels: één tekst per festival per taal
-- -----------------------------------------------------------------------------
ALTER TABLE festivals ADD COLUMN house_rules_nl text;
ALTER TABLE festivals ADD COLUMN house_rules_en text;
ALTER TABLE festivals ADD CONSTRAINT festivals_house_rules_length
    CHECK (char_length(house_rules_nl) <= 5000 AND char_length(house_rules_en) <= 5000);

-- -----------------------------------------------------------------------------
-- veelgestelde vragen
-- -----------------------------------------------------------------------------
CREATE TABLE faq_items (
    id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    festival_id  uuid        NOT NULL REFERENCES festivals(id) ON DELETE CASCADE,
    question_nl  text        NOT NULL,
    question_en  text        NOT NULL,
    answer_nl    text        NOT NULL,
    answer_en    text        NOT NULL,
    sort_order   integer     NOT NULL DEFAULT 0,
    created_at   timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT faq_items_question_length CHECK (char_length(question_nl) BETWEEN 1 AND 200 AND char_length(question_en) BETWEEN 1 AND 200),
    CONSTRAINT faq_items_answer_length   CHECK (char_length(answer_nl) BETWEEN 1 AND 2000 AND char_length(answer_en) BETWEEN 1 AND 2000)
);
CREATE INDEX faq_items_festival_idx ON faq_items (festival_id, sort_order);

-- -----------------------------------------------------------------------------
-- plattegrond: één afbeelding per festival. In de database, zodat een back-up
-- alles bevat en er geen aparte opslag nodig is. Alleen png, jpeg en webp
-- (geen svg: daar kan script in zitten).
-- -----------------------------------------------------------------------------
CREATE TABLE site_maps (
    festival_id   uuid        PRIMARY KEY REFERENCES festivals(id) ON DELETE CASCADE,
    content_type  text        NOT NULL,
    data          bytea       NOT NULL,
    updated_by    uuid        REFERENCES users(id) ON DELETE SET NULL,
    updated_at    timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT site_maps_type CHECK (content_type IN ('image/png', 'image/jpeg', 'image/webp')),
    CONSTRAINT site_maps_size CHECK (octet_length(data) BETWEEN 1 AND 3145728)  -- max. 3 MB
);

-- -----------------------------------------------------------------------------
-- gevonden voorwerpen. Alleen een korte omschrijving: geen namen of foto's,
-- zodat er geen persoonsgegevens van de eigenaar in de app komen.
-- -----------------------------------------------------------------------------
CREATE TYPE lost_item_status AS ENUM ('gevonden', 'opgehaald');

CREATE TABLE lost_items (
    id            uuid             PRIMARY KEY DEFAULT gen_random_uuid(),
    festival_id   uuid             NOT NULL REFERENCES festivals(id) ON DELETE CASCADE,
    description   text             NOT NULL,
    found_where   text,
    found_at      timestamptz      NOT NULL DEFAULT now(),
    status        lost_item_status NOT NULL DEFAULT 'gevonden',
    collected_at  timestamptz,
    created_by    uuid             REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT lost_items_description_length CHECK (char_length(description) BETWEEN 1 AND 200),
    CONSTRAINT lost_items_where_length       CHECK (found_where IS NULL OR char_length(found_where) BETWEEN 1 AND 100),
    CONSTRAINT lost_items_collected          CHECK ((status = 'opgehaald') = (collected_at IS NOT NULL))
);
CREATE INDEX lost_items_festival_idx ON lost_items (festival_id, found_at DESC);

COMMIT;
