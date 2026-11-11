-- =============================================================================
-- Festivalapp — migratie 0004: meerdere festivals en rollen per festival
-- PostgreSQL 16+
--
-- Tot nu toe was er één festival per installatie. Vanaf nu:
--   * festivals            elk festival heeft een naam en een begin- en einddatum
--   * festival_id          podia, mededelingen, SOS, kaartpunten, tickets, locaties
--                          en pins horen bij één festival
--   * tickets.user_id      een account kan meerdere tickets hebben (één per festival)
--   * festival_members     rol per festival: beheerder, organisatie, ehbo, beveiliging
--   * users.platform_role  rol over alle festivals heen: eigenaar of sudo
--   * festival_blocks      een bezoeker blokkeren voor één festival
--
-- Alle bestaande gegevens komen onder één eerste festival ("Testfestival").
-- users.role en users.ticket_id verdwijnen: de rol volgt nu uit festival_members
-- en platform_role, het ticket uit tickets.user_id.
-- =============================================================================

BEGIN;

CREATE TYPE platform_role AS ENUM ('eigenaar', 'sudo');
CREATE TYPE festival_role AS ENUM ('beheerder', 'organisatie', 'ehbo', 'beveiliging');

-- -----------------------------------------------------------------------------
-- festivals
-- -----------------------------------------------------------------------------
CREATE TABLE festivals (
    id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    name        text        NOT NULL,
    starts_at   timestamptz NOT NULL,
    ends_at     timestamptz NOT NULL,
    created_at  timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT festivals_name_length CHECK (char_length(name) BETWEEN 1 AND 80),
    CONSTRAINT festivals_period      CHECK (ends_at > starts_at)
);

-- Het eerste festival: hier komen alle bestaande gegevens onder. Vaste id, zodat
-- de regels hieronder ernaar kunnen verwijzen. Naam en datums zijn in het portal aan te passen.
INSERT INTO festivals (id, name, starts_at, ends_at)
VALUES ('00000000-0000-4000-8000-000000000001', 'Testfestival',
        date_trunc('day', now()) - interval '1 day', date_trunc('day', now()) + interval '90 days');

-- -----------------------------------------------------------------------------
-- festival_id op alles wat bij één festival hoort
-- (optredens en drukte horen via hun podium bij een festival)
-- -----------------------------------------------------------------------------
-- De DEFAULT zet alle bestaande rijen op het eerste festival; daarna halen we hem weg,
-- zodat nieuwe rijen altijd zelf een festival moeten opgeven.
ALTER TABLE stages        ADD COLUMN festival_id uuid NOT NULL DEFAULT '00000000-0000-4000-8000-000000000001' REFERENCES festivals(id) ON DELETE CASCADE;
ALTER TABLE announcements ADD COLUMN festival_id uuid NOT NULL DEFAULT '00000000-0000-4000-8000-000000000001' REFERENCES festivals(id) ON DELETE CASCADE;
ALTER TABLE sos_alerts    ADD COLUMN festival_id uuid NOT NULL DEFAULT '00000000-0000-4000-8000-000000000001' REFERENCES festivals(id) ON DELETE CASCADE;
ALTER TABLE map_points    ADD COLUMN festival_id uuid NOT NULL DEFAULT '00000000-0000-4000-8000-000000000001' REFERENCES festivals(id) ON DELETE CASCADE;
ALTER TABLE tickets       ADD COLUMN festival_id uuid NOT NULL DEFAULT '00000000-0000-4000-8000-000000000001' REFERENCES festivals(id) ON DELETE CASCADE;
ALTER TABLE locations     ADD COLUMN festival_id uuid NOT NULL DEFAULT '00000000-0000-4000-8000-000000000001' REFERENCES festivals(id) ON DELETE CASCADE;
ALTER TABLE pins          ADD COLUMN festival_id uuid NOT NULL DEFAULT '00000000-0000-4000-8000-000000000001' REFERENCES festivals(id) ON DELETE CASCADE;

ALTER TABLE stages        ALTER COLUMN festival_id DROP DEFAULT;
ALTER TABLE announcements ALTER COLUMN festival_id DROP DEFAULT;
ALTER TABLE sos_alerts    ALTER COLUMN festival_id DROP DEFAULT;
ALTER TABLE map_points    ALTER COLUMN festival_id DROP DEFAULT;
ALTER TABLE tickets       ALTER COLUMN festival_id DROP DEFAULT;
ALTER TABLE locations     ALTER COLUMN festival_id DROP DEFAULT;
ALTER TABLE pins          ALTER COLUMN festival_id DROP DEFAULT;

CREATE INDEX announcements_festival_idx ON announcements (festival_id, created_at DESC);
CREATE INDEX sos_alerts_festival_idx    ON sos_alerts (festival_id, created_at);
CREATE INDEX map_points_festival_idx    ON map_points (festival_id);
CREATE INDEX tickets_festival_idx       ON tickets (festival_id);
CREATE INDEX locations_festival_idx     ON locations (festival_id);
CREATE INDEX pins_festival_idx          ON pins (festival_id);

-- Een podiumnaam hoeft alleen binnen één festival uniek te zijn
ALTER TABLE stages DROP CONSTRAINT stages_name_key;
ALTER TABLE stages ADD CONSTRAINT stages_name_per_festival UNIQUE (festival_id, name);  -- dient ook als index op festival_id

-- -----------------------------------------------------------------------------
-- tickets horen bij een account (was: account hoort bij één ticket)
-- -----------------------------------------------------------------------------
ALTER TABLE tickets ADD COLUMN user_id uuid REFERENCES users(id) ON DELETE SET NULL;
UPDATE tickets t SET user_id = u.id FROM users u WHERE u.ticket_id = t.id;
-- hoogstens één ticket per account per festival
CREATE UNIQUE INDEX tickets_one_per_user_per_festival ON tickets (user_id, festival_id) WHERE user_id IS NOT NULL;

-- -----------------------------------------------------------------------------
-- rollen
-- -----------------------------------------------------------------------------
CREATE TABLE festival_members (
    festival_id  uuid          NOT NULL REFERENCES festivals(id) ON DELETE CASCADE,
    user_id      uuid          NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role         festival_role NOT NULL,
    added_by     uuid          REFERENCES users(id) ON DELETE SET NULL,
    created_at   timestamptz   NOT NULL DEFAULT now(),
    PRIMARY KEY (festival_id, user_id)
);
CREATE INDEX festival_members_user_idx ON festival_members (user_id);

-- Bestaande organisatie- en beheerdersaccounts krijgen dezelfde rol bij het eerste festival
INSERT INTO festival_members (festival_id, user_id, role)
SELECT '00000000-0000-4000-8000-000000000001', id, role::text::festival_role
  FROM users WHERE role <> 'bezoeker';

ALTER TABLE users ADD COLUMN platform_role platform_role;
-- Er is hoogstens één sudo-account (wordt met een script op de server gezet)
CREATE UNIQUE INDEX users_one_sudo ON users ((true)) WHERE platform_role = 'sudo';

ALTER TABLE users DROP CONSTRAINT users_visitor_has_ticket;
ALTER TABLE users DROP COLUMN ticket_id;
ALTER TABLE users DROP COLUMN role;
DROP TYPE user_role;

-- -----------------------------------------------------------------------------
-- blokkeren voor één festival (users.blocked_at blijft: dat is "alle festivals")
-- -----------------------------------------------------------------------------
CREATE TABLE festival_blocks (
    festival_id  uuid        NOT NULL REFERENCES festivals(id) ON DELETE CASCADE,
    user_id      uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    reason       text        NOT NULL,
    blocked_by   uuid        REFERENCES users(id) ON DELETE SET NULL,
    created_at   timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (festival_id, user_id),
    CONSTRAINT festival_blocks_reason_length CHECK (char_length(reason) BETWEEN 1 AND 200)
);

COMMIT;
