-- =============================================================================
-- Festivalapp — migratie 0006: mail (e-mailadres bevestigen, wachtwoord vergeten)
-- PostgreSQL 16+
--
--   * users.email_verified_at  wanneer het e-mailadres is bevestigd (leeg = nog niet)
--   * email_tokens             links uit een mail; alleen de SHA-256 van de token staat hier,
--                              net als bij refresh-tokens. Een token werkt maar één keer.
-- =============================================================================

BEGIN;

ALTER TABLE users ADD COLUMN email_verified_at timestamptz;

CREATE TYPE email_token_purpose AS ENUM ('verify', 'reset');

CREATE TABLE email_tokens (
    id           uuid                PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      uuid                NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    purpose      email_token_purpose NOT NULL,
    token_hash   text                NOT NULL UNIQUE,
    created_at   timestamptz         NOT NULL DEFAULT now(),
    expires_at   timestamptz         NOT NULL,
    used_at      timestamptz,
    -- Een resetlink is hooguit 1 uur geldig, een bevestigingslink hooguit 2 dagen
    CONSTRAINT email_tokens_expires_after_created CHECK (expires_at > created_at),
    CONSTRAINT email_tokens_max_lifetime CHECK (
        expires_at <= created_at + CASE purpose WHEN 'reset' THEN interval '1 hour' ELSE interval '2 days' END
    ),
    CONSTRAINT email_tokens_hash_format CHECK (token_hash ~ '^[0-9a-f]{64}$')
);
CREATE INDEX email_tokens_user_idx ON email_tokens (user_id, purpose);

COMMIT;
