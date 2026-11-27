-- =============================================================================
-- Festivalapp — migratie 0013: NFC-polsbanden, saldo, poortjes en check-ins
-- PostgreSQL 16+
--
-- De NFC-terminals (issue #79) lezen het nummer (UID) van een polsband. We slaan dat nummer nooit
-- zelf op, alleen de SHA-256 van de UID in hoofdletters (hex), net als bij ticketcodes.
--  - wristbands:          een polsband hoort bij één festival en wordt in de app aan een account gekoppeld.
--                         Kwijt = blokkeren (blocked_at). Per account per festival één actieve polsband.
--  - wallets:             het saldo per account per festival, in centen. Een nieuwe polsband houdt het saldo.
--  - wallet_transactions: betalingen en opwaarderingen. De id komt van de terminal, zodat een betaling die
--                         twee keer wordt verstuurd (bijv. na wegvallen van wifi) maar één keer telt.
--                         Een offline betaling kan het saldo onder nul brengen; de terminal staat
--                         offline maar kleine bedragen toe (zie src/routes/wallet.ts).
--  - gate_scans:          elke scan bij een poortje, ook als iemand niet naar binnen mocht.
--  - stage_checkins:      een tik op de paal bij een podium. Daaruit rekenen we de drukte uit.
-- =============================================================================

BEGIN;

CREATE TYPE wallet_transaction_kind AS ENUM ('betaling', 'opwaardering');
CREATE TYPE gate_direction AS ENUM ('in', 'uit');

CREATE TABLE wristbands (
    id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    festival_id  uuid        NOT NULL REFERENCES festivals(id) ON DELETE CASCADE,
    uid_hash     text        NOT NULL,                                   -- SHA-256 van de UID (hex, hoofdletters)
    user_id      uuid        REFERENCES users(id) ON DELETE SET NULL,
    linked_at    timestamptz,
    blocked_at   timestamptz,
    created_at   timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT wristbands_uid_per_festival UNIQUE (festival_id, uid_hash),
    CONSTRAINT wristbands_linked_has_date CHECK ((user_id IS NULL) OR (linked_at IS NOT NULL))
);
-- Eén actieve (niet geblokkeerde) polsband per account per festival
CREATE UNIQUE INDEX wristbands_one_active_per_user ON wristbands (festival_id, user_id)
    WHERE user_id IS NOT NULL AND blocked_at IS NULL;

CREATE TABLE wallets (
    festival_id    uuid        NOT NULL REFERENCES festivals(id) ON DELETE CASCADE,
    user_id        uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    balance_cents  integer     NOT NULL DEFAULT 0,
    updated_at     timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (festival_id, user_id)
);

CREATE TABLE wallet_transactions (
    id             uuid                    PRIMARY KEY,                  -- gekozen door de terminal
    festival_id    uuid                    NOT NULL REFERENCES festivals(id) ON DELETE CASCADE,
    user_id        uuid                    REFERENCES users(id) ON DELETE SET NULL,
    wristband_id   uuid                    REFERENCES wristbands(id) ON DELETE SET NULL,
    kind           wallet_transaction_kind NOT NULL,
    amount_cents   integer                 NOT NULL,
    balance_after  integer                 NOT NULL,
    device_id      text                    NOT NULL,
    offline        boolean                 NOT NULL DEFAULT false,
    occurred_at    timestamptz             NOT NULL,
    created_at     timestamptz             NOT NULL DEFAULT now(),
    CONSTRAINT wallet_transactions_amount_pos CHECK (amount_cents > 0)
);
CREATE INDEX wallet_transactions_user_idx ON wallet_transactions (festival_id, user_id, occurred_at DESC);

CREATE TABLE gate_scans (
    id            bigint         GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    festival_id   uuid           NOT NULL REFERENCES festivals(id) ON DELETE CASCADE,
    wristband_id  uuid           REFERENCES wristbands(id) ON DELETE SET NULL,
    user_id       uuid           REFERENCES users(id) ON DELETE SET NULL,
    device_id     text           NOT NULL,
    direction     gate_direction NOT NULL,
    allowed       boolean        NOT NULL,
    reason        text,                                                   -- waarom niet, bijv. 'geen_ticket'
    scanned_at    timestamptz    NOT NULL DEFAULT now()
);
CREATE INDEX gate_scans_festival_idx ON gate_scans (festival_id, scanned_at DESC);

CREATE TABLE stage_checkins (
    id             bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    stage_id       uuid        NOT NULL REFERENCES stages(id) ON DELETE CASCADE,
    wristband_id   uuid        NOT NULL REFERENCES wristbands(id) ON DELETE CASCADE,
    device_id      text        NOT NULL,
    checked_in_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX stage_checkins_recent_idx ON stage_checkins (checked_in_at DESC, wristband_id);

COMMIT;
