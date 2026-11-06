-- =============================================================================
-- Festivalapp — migratie 0001: eerste schema (17 tabellen)
-- PostgreSQL 16+
--
-- Uitgangspunten (zie docs/assurance-case.md en docs/security-eisen.md):
--   * Geen geheimen in platte tekst: wachtwoorden, refresh-tokens, vriendcodes
--     en IoT-sleutels worden alleen als hash opgeslagen.
--   * Dataminimalisatie: per gebruiker bewaren we alleen de LAATSTE locatie,
--     met een verloopdatum. Er is geen locatiegeschiedenis.
--   * Integriteit in de database zelf (CHECK, UNIQUE, FK), niet alleen in de API.
--   * Eén festival per installatie; er is dus geen tabel "festivals".
-- =============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS citext;     -- hoofdletterongevoelige e-mail

-- -----------------------------------------------------------------------------
-- Enums
-- -----------------------------------------------------------------------------
CREATE TYPE user_role          AS ENUM ('bezoeker', 'organisatie', 'beheerder');
CREATE TYPE app_theme          AS ENUM ('systeem', 'licht', 'donker');
CREATE TYPE app_locale         AS ENUM ('nl', 'en');
CREATE TYPE ticket_status      AS ENUM ('geldig', 'gekoppeld', 'ingetrokken');
CREATE TYPE pin_visibility     AS ENUM ('prive', 'vrienden');
CREATE TYPE performance_status AS ENUM ('gepland', 'vertraagd', 'verplaatst', 'geannuleerd');
CREATE TYPE announcement_level AS ENUM ('info', 'waarschuwing', 'nood');
CREATE TYPE sos_status         AS ENUM ('open', 'in_behandeling', 'afgehandeld');
CREATE TYPE crowd_level        AS ENUM ('rustig', 'gemiddeld', 'druk', 'vol');

-- -----------------------------------------------------------------------------
-- 1. tickets — geïmporteerd door de organisatie; een account hoort bij één ticket
-- -----------------------------------------------------------------------------
CREATE TABLE tickets (
    id            uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
    code_hash     text          NOT NULL UNIQUE,          -- SHA-256 van de ticketcode
    ticket_type   text          NOT NULL DEFAULT 'weekend',
    valid_from    timestamptz   NOT NULL,
    valid_until   timestamptz   NOT NULL,
    status        ticket_status NOT NULL DEFAULT 'geldig',
    created_at    timestamptz   NOT NULL DEFAULT now(),
    CONSTRAINT tickets_valid_period CHECK (valid_until > valid_from)
);

-- -----------------------------------------------------------------------------
-- 2. users — account + instellingen
-- -----------------------------------------------------------------------------
CREATE TABLE users (
    id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    ticket_id        uuid        UNIQUE REFERENCES tickets(id) ON DELETE RESTRICT,
    email            citext      NOT NULL UNIQUE,
    password_hash    text        NOT NULL,                 -- argon2id
    display_name     text        NOT NULL,
    role             user_role   NOT NULL DEFAULT 'bezoeker',
    theme            app_theme   NOT NULL DEFAULT 'systeem',
    locale           app_locale  NOT NULL DEFAULT 'nl',
    share_location   boolean     NOT NULL DEFAULT false,   -- privacy: standaard uit
    share_timetable  boolean     NOT NULL DEFAULT false,
    failed_logins    integer     NOT NULL DEFAULT 0,
    locked_until     timestamptz,
    created_at       timestamptz NOT NULL DEFAULT now(),
    updated_at       timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT users_display_name_length CHECK (char_length(display_name) BETWEEN 1 AND 40),
    CONSTRAINT users_email_format        CHECK (email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
    CONSTRAINT users_password_is_hash    CHECK (password_hash LIKE '$argon2id$%'),
    CONSTRAINT users_failed_logins_pos   CHECK (failed_logins >= 0),
    -- bezoekers hebben altijd een ticket; personeel van de organisatie niet per se
    CONSTRAINT users_visitor_has_ticket  CHECK (role <> 'bezoeker' OR ticket_id IS NOT NULL)
);

-- -----------------------------------------------------------------------------
-- 3. sessions — refresh-tokens (alleen de hash), intrekbaar
-- -----------------------------------------------------------------------------
CREATE TABLE sessions (
    id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    refresh_token_hash  text        NOT NULL UNIQUE,
    user_agent          text,
    created_at          timestamptz NOT NULL DEFAULT now(),
    expires_at          timestamptz NOT NULL,
    revoked_at          timestamptz,
    CONSTRAINT sessions_expiry_after_creation CHECK (expires_at > created_at)
);
CREATE INDEX sessions_user_idx ON sessions (user_id) WHERE revoked_at IS NULL;

-- -----------------------------------------------------------------------------
-- 4. friend_codes — tijdelijke code/QR om een vriend toe te voegen
-- -----------------------------------------------------------------------------
CREATE TABLE friend_codes (
    id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    code_hash   text        NOT NULL UNIQUE,
    created_at  timestamptz NOT NULL DEFAULT now(),
    expires_at  timestamptz NOT NULL,
    used_at     timestamptz,
    used_by     uuid        REFERENCES users(id) ON DELETE SET NULL,
    -- een code is maximaal 15 minuten geldig
    CONSTRAINT friend_codes_short_lived CHECK (
        expires_at > created_at AND expires_at <= created_at + interval '15 minutes'
    ),
    CONSTRAINT friend_codes_not_self CHECK (used_by IS NULL OR used_by <> user_id),
    CONSTRAINT friend_codes_used_consistent CHECK ((used_at IS NULL) = (used_by IS NULL))
);
CREATE INDEX friend_codes_user_idx ON friend_codes (user_id);

-- -----------------------------------------------------------------------------
-- 5. friendships — wederzijds, één rij per paar (user_a < user_b)
-- -----------------------------------------------------------------------------
CREATE TABLE friendships (
    user_a      uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    user_b      uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at  timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_a, user_b),
    CONSTRAINT friendships_ordered CHECK (user_a < user_b)
);
CREATE INDEX friendships_user_b_idx ON friendships (user_b);

-- -----------------------------------------------------------------------------
-- 6. locations — alleen de laatste locatie per gebruiker, verloopt vanzelf
-- -----------------------------------------------------------------------------
CREATE TABLE locations (
    user_id      uuid             PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    latitude     double precision NOT NULL,
    longitude    double precision NOT NULL,
    accuracy_m   real,
    recorded_at  timestamptz      NOT NULL DEFAULT now(),
    expires_at   timestamptz      NOT NULL,
    CONSTRAINT locations_lat_range  CHECK (latitude  BETWEEN -90  AND 90),
    CONSTRAINT locations_lng_range  CHECK (longitude BETWEEN -180 AND 180),
    CONSTRAINT locations_accuracy   CHECK (accuracy_m IS NULL OR accuracy_m >= 0),
    CONSTRAINT locations_short_lived CHECK (
        expires_at > recorded_at AND expires_at <= recorded_at + interval '1 hour'
    )
);
CREATE INDEX locations_expires_idx ON locations (expires_at);

-- -----------------------------------------------------------------------------
-- 7. pins — eigen markeringen op de kaart ("onze tent", "ontmoetpunt")
-- -----------------------------------------------------------------------------
CREATE TABLE pins (
    id          uuid             PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     uuid             NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    label       text             NOT NULL,
    latitude    double precision NOT NULL,
    longitude   double precision NOT NULL,
    visibility  pin_visibility   NOT NULL DEFAULT 'vrienden',
    created_at  timestamptz      NOT NULL DEFAULT now(),
    CONSTRAINT pins_label_length CHECK (char_length(label) BETWEEN 1 AND 60),
    CONSTRAINT pins_lat_range    CHECK (latitude  BETWEEN -90  AND 90),
    CONSTRAINT pins_lng_range    CHECK (longitude BETWEEN -180 AND 180)
);
CREATE INDEX pins_user_idx ON pins (user_id);

-- -----------------------------------------------------------------------------
-- 8. messages — chat tussen twee vrienden
-- -----------------------------------------------------------------------------
CREATE TABLE messages (
    id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    sender_id     uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    recipient_id  uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    body          text        NOT NULL,
    created_at    timestamptz NOT NULL DEFAULT now(),
    read_at       timestamptz,
    CONSTRAINT messages_not_self   CHECK (sender_id <> recipient_id),
    CONSTRAINT messages_body_length CHECK (char_length(body) BETWEEN 1 AND 1000)
);
CREATE INDEX messages_conversation_idx
    ON messages (LEAST(sender_id, recipient_id), GREATEST(sender_id, recipient_id), created_at DESC);

-- -----------------------------------------------------------------------------
-- 9. stages — podia en hun plek op het terrein
-- -----------------------------------------------------------------------------
CREATE TABLE stages (
    id          uuid             PRIMARY KEY DEFAULT gen_random_uuid(),
    name        text             NOT NULL UNIQUE,
    latitude    double precision NOT NULL,
    longitude   double precision NOT NULL,
    capacity    integer          NOT NULL,
    sort_order  integer          NOT NULL DEFAULT 0,
    CONSTRAINT stages_capacity_pos CHECK (capacity > 0),
    CONSTRAINT stages_lat_range    CHECK (latitude  BETWEEN -90  AND 90),
    CONSTRAINT stages_lng_range    CHECK (longitude BETWEEN -180 AND 180)
);

-- -----------------------------------------------------------------------------
-- 10. performances — de timetable (beheerd via het portal)
-- -----------------------------------------------------------------------------
CREATE TABLE performances (
    id               uuid               PRIMARY KEY DEFAULT gen_random_uuid(),
    stage_id         uuid               NOT NULL REFERENCES stages(id) ON DELETE RESTRICT,
    artist           text               NOT NULL,
    description      text,
    starts_at        timestamptz        NOT NULL,
    ends_at          timestamptz        NOT NULL,
    status           performance_status NOT NULL DEFAULT 'gepland',
    signup_capacity  integer,           -- NULL = geen aanmelding nodig
    updated_at       timestamptz        NOT NULL DEFAULT now(),
    CONSTRAINT performances_time_order    CHECK (ends_at > starts_at),
    CONSTRAINT performances_signup_cap    CHECK (signup_capacity IS NULL OR signup_capacity > 0)
);
CREATE INDEX performances_stage_time_idx ON performances (stage_id, starts_at);

-- -----------------------------------------------------------------------------
-- 11. timetable_entries — persoonlijke timetable (favorieten)
-- -----------------------------------------------------------------------------
CREATE TABLE timetable_entries (
    user_id         uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    performance_id  uuid        NOT NULL REFERENCES performances(id) ON DELETE CASCADE,
    created_at      timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, performance_id)
);
CREATE INDEX timetable_entries_performance_idx ON timetable_entries (performance_id);

-- -----------------------------------------------------------------------------
-- 12. show_signups — aanmelden voor een show met beperkte plekken (IoT)
-- -----------------------------------------------------------------------------
CREATE TABLE show_signups (
    user_id         uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    performance_id  uuid        NOT NULL REFERENCES performances(id) ON DELETE CASCADE,
    created_at      timestamptz NOT NULL DEFAULT now(),
    checked_in_at   timestamptz,
    PRIMARY KEY (user_id, performance_id)
);

-- -----------------------------------------------------------------------------
-- 13. crowd_readings — drukte per podium, gemeten door IoT-sensoren
-- -----------------------------------------------------------------------------
CREATE TABLE crowd_readings (
    id           bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    stage_id     uuid        NOT NULL REFERENCES stages(id) ON DELETE CASCADE,
    device_id    text        NOT NULL,
    head_count   integer     NOT NULL,
    level        crowd_level NOT NULL,
    measured_at  timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT crowd_readings_count_pos CHECK (head_count >= 0)
);
CREATE INDEX crowd_readings_latest_idx ON crowd_readings (stage_id, measured_at DESC);

-- -----------------------------------------------------------------------------
-- 14. push_subscriptions — Web Push-abonnementen per apparaat
-- -----------------------------------------------------------------------------
CREATE TABLE push_subscriptions (
    id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    endpoint    text        NOT NULL UNIQUE,
    p256dh      text        NOT NULL,
    auth        text        NOT NULL,
    created_at  timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT push_subscriptions_https CHECK (endpoint LIKE 'https://%')
);
CREATE INDEX push_subscriptions_user_idx ON push_subscriptions (user_id);

-- -----------------------------------------------------------------------------
-- 15. announcements — live updates en noodberichten van de organisatie
-- -----------------------------------------------------------------------------
CREATE TABLE announcements (
    id          uuid               PRIMARY KEY DEFAULT gen_random_uuid(),
    author_id   uuid               REFERENCES users(id) ON DELETE SET NULL,
    level       announcement_level NOT NULL DEFAULT 'info',
    title_nl    text               NOT NULL,
    title_en    text               NOT NULL,
    body_nl     text               NOT NULL,
    body_en     text               NOT NULL,
    created_at  timestamptz        NOT NULL DEFAULT now(),
    expires_at  timestamptz,
    CONSTRAINT announcements_title_length CHECK (
        char_length(title_nl) BETWEEN 1 AND 120 AND char_length(title_en) BETWEEN 1 AND 120
    ),
    CONSTRAINT announcements_body_length CHECK (
        char_length(body_nl) BETWEEN 1 AND 2000 AND char_length(body_en) BETWEEN 1 AND 2000
    ),
    CONSTRAINT announcements_expiry CHECK (expires_at IS NULL OR expires_at > created_at)
);
CREATE INDEX announcements_created_idx ON announcements (created_at DESC);

-- -----------------------------------------------------------------------------
-- 16. sos_alerts — SOS-knop van bezoekers, opgevolgd via het portal
-- -----------------------------------------------------------------------------
CREATE TABLE sos_alerts (
    id           uuid             PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      uuid             REFERENCES users(id) ON DELETE SET NULL,
    latitude     double precision,
    longitude    double precision,
    message      text,
    status       sos_status       NOT NULL DEFAULT 'open',
    handled_by   uuid             REFERENCES users(id) ON DELETE SET NULL,
    created_at   timestamptz      NOT NULL DEFAULT now(),
    resolved_at  timestamptz,
    CONSTRAINT sos_alerts_coords_together CHECK ((latitude IS NULL) = (longitude IS NULL)),
    CONSTRAINT sos_alerts_lat_range CHECK (latitude  IS NULL OR latitude  BETWEEN -90  AND 90),
    CONSTRAINT sos_alerts_lng_range CHECK (longitude IS NULL OR longitude BETWEEN -180 AND 180),
    CONSTRAINT sos_alerts_message_length CHECK (message IS NULL OR char_length(message) <= 500),
    CONSTRAINT sos_alerts_resolved_consistent CHECK ((status = 'afgehandeld') = (resolved_at IS NOT NULL))
);
CREATE INDEX sos_alerts_open_idx ON sos_alerts (created_at) WHERE status <> 'afgehandeld';

-- -----------------------------------------------------------------------------
-- 17. audit_log — wie deed wat in het beheerportal en bij beveiligingsgebeurtenissen
--     Alleen toevoegen: UPDATE en DELETE worden geweigerd door een trigger.
-- -----------------------------------------------------------------------------
CREATE TABLE audit_log (
    id           bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    actor_id     uuid,                       -- bewust geen FK: rijen blijven bestaan na accountverwijdering
    action       text        NOT NULL,          -- bv. 'announcement.create', 'auth.login_failed'
    target_type  text,
    target_id    text,
    details      jsonb       NOT NULL DEFAULT '{}'::jsonb,
    created_at   timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT audit_log_action_format CHECK (action ~ '^[a-z_]+\.[a-z_]+$')
);
CREATE INDEX audit_log_created_idx ON audit_log (created_at DESC);

CREATE FUNCTION audit_log_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'audit_log is append-only (% geweigerd)', TG_OP;
END;
$$;

CREATE TRIGGER audit_log_no_update_delete
    BEFORE UPDATE OR DELETE ON audit_log
    FOR EACH ROW EXECUTE FUNCTION audit_log_append_only();

-- -----------------------------------------------------------------------------
-- updated_at automatisch bijwerken
-- -----------------------------------------------------------------------------
CREATE FUNCTION set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END;
$$;

CREATE TRIGGER users_set_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER performances_set_updated_at
    BEFORE UPDATE ON performances
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMIT;
