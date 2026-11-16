-- =============================================================================
-- Festivalapp — migratie 0008: groepsapps, foto's delen en vriendschapsverzoeken
-- PostgreSQL 16+
--
--   * groups           een groepsapp met naam, omschrijving en groepsfoto
--   * group_members    wie erin zit, met rol, gelezen-tot en dempen
--   * photos           gedeelde foto's: van een groep, of van twee mensen samen (het album van
--                      een gewone chat). Een foto in een bericht staat hier ook in.
--   * messages         (bestaande tabel) geldt nu voor een gesprek met één vriend én voor een groep.
--                      Erbij: foto, reageren op een bericht, emoji-reacties, systeemregels en verwijderen.
--   * friend_requests  vriendschapsverzoek dat de ander moet accepteren. Bewust een eigen tabel en
--                      geen extra status in friendships: alle bestaande queries (locatie, pins, chat,
--                      timetable) gaan ervan uit dat een rij in friendships betekent "jullie zijn vrienden".
--                      Een openstaand verzoek daar zou de locatie al aan de ander laten zien.
--
-- Foto's staan als bytea in de database, net als de plattegrond (0005). Zo zit alles in de
-- nachtelijke back-up en is er geen aparte opslag nodig. Svg mag niet: daar kan script in zitten.
-- =============================================================================

BEGIN;

CREATE TYPE group_role AS ENUM ('beheerder', 'lid');
CREATE TYPE message_kind AS ENUM ('tekst', 'foto', 'systeem');

-- -----------------------------------------------------------------------------
-- groepen
-- -----------------------------------------------------------------------------
CREATE TABLE groups (
    id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    name                text        NOT NULL,
    description         text,
    -- groepsfoto (het rondje bij de naam); hoort niet bij het album
    picture_type        text,
    picture_data        bytea,
    picture_updated_at  timestamptz,
    created_by          uuid        REFERENCES users(id) ON DELETE SET NULL,
    created_at          timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT groups_name_length        CHECK (char_length(name) BETWEEN 1 AND 60),
    CONSTRAINT groups_description_length CHECK (char_length(description) <= 500),
    -- foto, type en tijdstip horen bij elkaar: alle drie of geen
    CONSTRAINT groups_picture_complete   CHECK (
        (picture_data IS NULL) = (picture_type IS NULL) AND (picture_data IS NULL) = (picture_updated_at IS NULL)
    ),
    CONSTRAINT groups_picture_size       CHECK (octet_length(picture_data) BETWEEN 1 AND 26214400)  -- max. 25 MB
);

-- -----------------------------------------------------------------------------
-- leden: één rij per persoon per groep (iemand kan in meerdere groepen zitten)
-- -----------------------------------------------------------------------------
CREATE TABLE group_members (
    group_id      uuid        NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    user_id       uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role          group_role  NOT NULL DEFAULT 'lid',
    added_by      uuid        REFERENCES users(id) ON DELETE SET NULL,
    joined_at     timestamptz NOT NULL DEFAULT now(),
    -- alles daarna telt als ongelezen
    last_read_at  timestamptz NOT NULL DEFAULT now(),
    -- geen pushmeldingen van deze groep
    muted         boolean     NOT NULL DEFAULT false,
    PRIMARY KEY (group_id, user_id)
);
CREATE INDEX group_members_user_idx ON group_members (user_id);

-- -----------------------------------------------------------------------------
-- foto's: van een groep (group_id) óf van twee mensen samen (user_a < user_b, zoals friendships)
-- -----------------------------------------------------------------------------
CREATE TABLE photos (
    id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    uploaded_by   uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    group_id      uuid        REFERENCES groups(id) ON DELETE CASCADE,
    user_a        uuid        REFERENCES users(id) ON DELETE CASCADE,
    user_b        uuid        REFERENCES users(id) ON DELETE CASCADE,
    content_type  text        NOT NULL,
    data          bytea       NOT NULL,
    caption       text,
    -- clock_timestamp: foto's die in één transactie worden toegevoegd houden een vaste volgorde
    created_at    timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT photos_one_place     CHECK ((group_id IS NULL) <> (user_a IS NULL)),
    CONSTRAINT photos_pair          CHECK ((user_a IS NULL) = (user_b IS NULL) AND (user_a IS NULL OR user_a < user_b)),
    -- tussen twee mensen kan alleen een van die twee de foto delen
    CONSTRAINT photos_pair_uploader CHECK (user_a IS NULL OR uploaded_by IN (user_a, user_b)),
    CONSTRAINT photos_type          CHECK (content_type IN (
        'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/avif',
        'image/heic', 'image/heif', 'image/bmp', 'image/tiff'
    )),
    CONSTRAINT photos_size          CHECK (octet_length(data) BETWEEN 1 AND 26214400),  -- max. 25 MB
    CONSTRAINT photos_caption       CHECK (char_length(caption) <= 1000)
);
CREATE INDEX photos_group_idx ON photos (group_id, created_at DESC) WHERE group_id IS NOT NULL;
CREATE INDEX photos_pair_idx  ON photos (user_a, user_b, created_at DESC) WHERE user_a IS NOT NULL;

-- -----------------------------------------------------------------------------
-- berichten: dezelfde tabel voor een gesprek met één vriend (recipient_id) en een groep (group_id)
-- -----------------------------------------------------------------------------
ALTER TABLE messages
    ALTER COLUMN recipient_id DROP NOT NULL,
    -- een foto zonder bijschrift of een verwijderd bericht heeft geen tekst
    ALTER COLUMN body DROP NOT NULL,
    -- twee systeemregels in één transactie ("aangemaakt", "toegevoegd") houden zo een vaste volgorde
    ALTER COLUMN created_at SET DEFAULT clock_timestamp(),
    ADD COLUMN group_id     uuid         REFERENCES groups(id) ON DELETE CASCADE,
    ADD COLUMN kind         message_kind NOT NULL DEFAULT 'tekst',
    -- wordt NULL als de foto weggehaald is; het bericht (met bijschrift) blijft dan staan
    ADD COLUMN photo_id     uuid         REFERENCES photos(id) ON DELETE SET NULL,
    ADD COLUMN reply_to_id  uuid         REFERENCES messages(id) ON DELETE SET NULL,
    -- systeemregel in een groep: { type, actor: {id, name}, targets: [{id, name}], value }
    ADD COLUMN system_event jsonb,
    -- emoji-reacties: { "<user-id>": "👍" }, één per persoon. In het bericht zelf in plaats van een
    -- aparte tabel: je leest ze altijd samen met het bericht.
    ADD COLUMN reactions    jsonb        NOT NULL DEFAULT '{}',
    ADD COLUMN deleted_at   timestamptz,
    ADD CONSTRAINT messages_one_conversation CHECK ((recipient_id IS NULL) <> (group_id IS NULL)),
    ADD CONSTRAINT messages_text_has_body    CHECK (kind <> 'tekst' OR deleted_at IS NOT NULL OR body IS NOT NULL),
    ADD CONSTRAINT messages_system           CHECK (
        (kind = 'systeem') = (system_event IS NOT NULL) AND (kind <> 'systeem' OR group_id IS NOT NULL)
    ),
    -- een verwijderd bericht bewaart geen inhoud en geen reacties meer
    ADD CONSTRAINT messages_deleted_empty    CHECK (deleted_at IS NULL OR (body IS NULL AND photo_id IS NULL AND reactions = '{}')),
    ADD CONSTRAINT messages_reactions_object CHECK (jsonb_typeof(reactions) = 'object');

CREATE INDEX messages_group_idx ON messages (group_id, created_at DESC) WHERE group_id IS NOT NULL;
CREATE INDEX messages_photo_idx ON messages (photo_id) WHERE photo_id IS NOT NULL;

-- -----------------------------------------------------------------------------
-- vriendschapsverzoeken
-- -----------------------------------------------------------------------------
CREATE TABLE friend_requests (
    from_user   uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    to_user     uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at  timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (from_user, to_user),
    CONSTRAINT friend_requests_not_self CHECK (from_user <> to_user)
);
CREATE INDEX friend_requests_to_idx ON friend_requests (to_user);

COMMIT;
