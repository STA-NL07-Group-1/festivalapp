-- Eerste database-schema van de Festivalapp (PostgreSQL 13 of hoger).
-- Bevat alleen de MVP. Uitbreidingen krijgen een eigen, nieuwe migratie.
-- Regels komen uit docs/api.yaml en docs/security-eisen.md.

BEGIN;

CREATE EXTENSION IF NOT EXISTS btree_gist;

-- Accounts. Een account blijft bestaan na een festival.
CREATE TABLE users (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username                 TEXT NOT NULL CHECK (username ~ '^[A-Za-z0-9_.]{3,40}$'),
  email                    TEXT NOT NULL CHECK (char_length(email) BETWEEN 3 AND 254),
  password_hash            TEXT NOT NULL, -- Argon2id, nooit leesbaar
  role                     TEXT NOT NULL DEFAULT 'bezoeker'
                           CHECK (role IN ('bezoeker', 'organisator', 'ehbo', 'security')),
  language                 TEXT NOT NULL DEFAULT 'nl' CHECK (language IN ('nl', 'en')),
  theme                    TEXT NOT NULL DEFAULT 'system' CHECK (theme IN ('system', 'light', 'dark')),
  location_sharing_enabled BOOLEAN NOT NULL DEFAULT false,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_username_unique ON users (lower(username));
CREATE UNIQUE INDEX users_email_unique ON users (lower(email));

-- Alleen de hash van het refresh token staat in de database.
CREATE TABLE refresh_tokens (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  CHECK (expires_at > created_at)
);
CREATE INDEX refresh_tokens_user_idx ON refresh_tokens (user_id);

-- Festivals en tickets
CREATE TABLE festivals (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name      TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at   TIMESTAMPTZ NOT NULL,
  CHECK (ends_at > starts_at)
);

-- Elk ticket heeft een eigen link uit de ticketmail. De link hoort bij het ticket.
CREATE TABLE tickets (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  festival_id        UUID NOT NULL REFERENCES festivals(id) ON DELETE RESTRICT,
  external_reference TEXT NOT NULL,
  email              TEXT NOT NULL,
  invite_token_hash  TEXT NOT NULL UNIQUE,
  invite_expires_at  TIMESTAMPTZ NOT NULL,
  invite_sent_at     TIMESTAMPTZ,
  user_id            UUID REFERENCES users(id) ON DELETE SET NULL,
  claimed_at         TIMESTAMPTZ,
  revoked_at         TIMESTAMPTZ,
  checked_out_at     TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (festival_id, external_reference),
  CHECK (user_id IS NULL OR claimed_at IS NOT NULL)
);
CREATE UNIQUE INDEX tickets_one_per_festival_idx ON tickets (festival_id, user_id) WHERE user_id IS NOT NULL;
CREATE INDEX tickets_user_idx ON tickets (user_id);

-- Vrienden. Een vriendcode is 10 minuten geldig en 1 keer bruikbaar.
CREATE TABLE friend_codes (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash  TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  used_at    TIMESTAMPTZ,
  CHECK (expires_at > created_at AND expires_at <= created_at + interval '10 minutes')
);
CREATE INDEX friend_codes_user_idx ON friend_codes (user_id, created_at);

-- Elk paar staat maar 1 keer in de tabel, met de laagste UUID in user_low_id.
CREATE TABLE friendships (
  user_low_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_high_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_low_id, user_high_id),
  CHECK (user_low_id < user_high_id)
);
CREATE INDEX friendships_high_idx ON friendships (user_high_id);

-- Vrienden die de locatie van deze gebruiker niet mogen zien.
CREATE TABLE location_hidden_friends (
  user_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  friend_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, friend_id),
  CHECK (user_id <> friend_id)
);
CREATE INDEX location_hidden_friends_friend_idx ON location_hidden_friends (friend_id);

-- Timetable
CREATE TABLE stages (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  festival_id UUID NOT NULL REFERENCES festivals(id) ON DELETE CASCADE,
  name        TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  latitude    DOUBLE PRECISION NOT NULL CHECK (latitude BETWEEN -90 AND 90),
  longitude   DOUBLE PRECISION NOT NULL CHECK (longitude BETWEEN -180 AND 180),
  UNIQUE (festival_id, name)
);

CREATE TABLE acts (
  id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE CHECK (char_length(name) BETWEEN 1 AND 120)
);

-- Heet Slot in docs/api.yaml.
CREATE TABLE performances (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  act_id     UUID NOT NULL REFERENCES acts(id) ON DELETE CASCADE,
  stage_id   UUID NOT NULL REFERENCES stages(id) ON DELETE RESTRICT,
  starts_at  TIMESTAMPTZ NOT NULL,
  ends_at    TIMESTAMPTZ NOT NULL,
  status     TEXT NOT NULL DEFAULT 'gepland' CHECK (status IN ('gepland', 'verplaatst', 'geannuleerd')),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at),
  -- Op 1 podium kunnen geen 2 optredens tegelijk zijn.
  EXCLUDE USING gist (stage_id WITH =, tstzrange(starts_at, ends_at) WITH &&)
    WHERE (status <> 'geannuleerd')
);
CREATE INDEX performances_act_idx ON performances (act_id);
CREATE INDEX performances_starts_idx ON performances (starts_at);

-- De persoonlijke timetable uit docs/api.yaml.
CREATE TABLE favorites (
  user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  performance_id UUID NOT NULL REFERENCES performances(id) ON DELETE CASCADE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, performance_id)
);
CREATE INDEX favorites_performance_idx ON favorites (performance_id);

-- Kaart. Alleen de laatste locatie, die de backend na 24 uur of na het festival verwijdert.
CREATE TABLE user_locations (
  user_id     UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  festival_id UUID NOT NULL REFERENCES festivals(id) ON DELETE CASCADE,
  latitude    DOUBLE PRECISION NOT NULL CHECK (latitude BETWEEN -90 AND 90),
  longitude   DOUBLE PRECISION NOT NULL CHECK (longitude BETWEEN -180 AND 180),
  accuracy_m  REAL CHECK (accuracy_m >= 0),
  recorded_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX user_locations_recorded_idx ON user_locations (recorded_at);
CREATE INDEX user_locations_festival_idx ON user_locations (festival_id);

CREATE TABLE map_pins (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id            UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  festival_id         UUID NOT NULL REFERENCES festivals(id) ON DELETE CASCADE,
  label               TEXT NOT NULL CHECK (char_length(label) BETWEEN 1 AND 40),
  latitude            DOUBLE PRECISION NOT NULL CHECK (latitude BETWEEN -90 AND 90),
  longitude           DOUBLE PRECISION NOT NULL CHECK (longitude BETWEEN -180 AND 180),
  shared_with_friends BOOLEAN NOT NULL DEFAULT true,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX map_pins_owner_idx ON map_pins (owner_id);
CREATE INDEX map_pins_festival_idx ON map_pins (festival_id);

-- Chat. client_message_id voorkomt dubbele berichten als de app opnieuw verstuurt.
CREATE TABLE messages (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_message_id UUID NOT NULL,
  festival_id       UUID NOT NULL REFERENCES festivals(id) ON DELETE CASCADE,
  sender_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  receiver_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body              TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 1000),
  sent_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  read_at           TIMESTAMPTZ,
  CHECK (sender_id <> receiver_id),
  UNIQUE (sender_id, client_message_id)
);
CREATE INDEX messages_conversation_idx
  ON messages (LEAST(sender_id, receiver_id), GREATEST(sender_id, receiver_id), sent_at DESC);
CREATE INDEX messages_festival_idx ON messages (festival_id);
CREATE INDEX messages_receiver_unread_idx ON messages (receiver_id) WHERE read_at IS NULL;

-- Pushmeldingen
CREATE TABLE push_subscriptions (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint     TEXT NOT NULL UNIQUE,
  p256dh_key   TEXT NOT NULL,
  auth_key     TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ
);
CREATE INDEX push_subscriptions_user_idx ON push_subscriptions (user_id);

CREATE TABLE notification_preferences (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type    TEXT NOT NULL CHECK (type IN ('chat', 'vriend', 'favoriete_act', 'timetable')),
  enabled BOOLEAN NOT NULL DEFAULT true,
  PRIMARY KEY (user_id, type)
);

-- Berichten van de organisatie. Een noodbericht heeft altijd een handtekening.
CREATE TABLE announcements (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  festival_id UUID NOT NULL REFERENCES festivals(id) ON DELETE CASCADE,
  type        TEXT NOT NULL CHECK (type IN ('info', 'update', 'nood')),
  title       TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 80),
  body        TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 500),
  signature   TEXT,
  created_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (type <> 'nood' OR signature IS NOT NULL)
);
CREATE INDEX announcements_festival_idx ON announcements (festival_id, created_at DESC);
CREATE INDEX announcements_created_by_idx ON announcements (created_by);

-- SOS-meldingen
CREATE TABLE sos_reports (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  festival_id UUID NOT NULL REFERENCES festivals(id) ON DELETE CASCADE,
  user_id     UUID REFERENCES users(id) ON DELETE SET NULL,
  type        TEXT NOT NULL CHECK (type IN ('medisch', 'veiligheid', 'anders')),
  note        TEXT CHECK (char_length(note) <= 200),
  latitude    DOUBLE PRECISION NOT NULL CHECK (latitude BETWEEN -90 AND 90),
  longitude   DOUBLE PRECISION NOT NULL CHECK (longitude BETWEEN -180 AND 180),
  status      TEXT NOT NULL DEFAULT 'ontvangen' CHECK (status IN ('ontvangen', 'onderweg', 'afgehandeld')),
  handled_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX sos_reports_festival_idx ON sos_reports (festival_id);
CREATE INDEX sos_reports_user_idx ON sos_reports (user_id, created_at);
CREATE INDEX sos_reports_handled_by_idx ON sos_reports (handled_by);
CREATE INDEX sos_reports_open_idx ON sos_reports (created_at) WHERE status <> 'afgehandeld';

-- Vrienden zijn alleen actief als beiden nu op hetzelfde festival zijn.
CREATE VIEW active_friendships AS
SELECT f.user_low_id, f.user_high_id, a.festival_id
FROM friendships f
JOIN tickets a ON a.user_id = f.user_low_id
JOIN tickets b ON b.user_id = f.user_high_id AND b.festival_id = a.festival_id
JOIN festivals fe ON fe.id = a.festival_id
WHERE now() BETWEEN fe.starts_at AND fe.ends_at
  AND a.revoked_at IS NULL AND b.revoked_at IS NULL
  AND a.checked_out_at IS NULL AND b.checked_out_at IS NULL;

COMMIT;
