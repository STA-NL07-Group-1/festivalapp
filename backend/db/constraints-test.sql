-- =============================================================================
-- Festivalapp — controle van de database-constraints
--
-- Draai NA de migraties op een lege testdatabase:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f backend/db/constraints-test.sql
--
-- Alles gebeurt in één transactie die aan het eind wordt teruggedraaid, dus
-- er blijft niets achter. Elke ongeldige invoer MOET worden geweigerd; zo niet,
-- dan stopt het script met een foutmelding "CONSTRAINT ONTBREEKT: ...".
-- =============================================================================

BEGIN;

-- Hulpfunctie: verwacht dat een statement faalt
CREATE FUNCTION pg_temp.expect_fail(description text, stmt text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
    BEGIN
        EXECUTE stmt;
    EXCEPTION WHEN others THEN
        RAISE NOTICE 'ok: % (%)', description, SQLERRM;
        RETURN;
    END;
    RAISE EXCEPTION 'CONSTRAINT ONTBREEKT: %', description;
END;
$$;

-- --- Testdata ----------------------------------------------------------------
INSERT INTO tickets (id, code_hash, valid_from, valid_until) VALUES
    ('00000000-0000-0000-0000-0000000000a1', 'hash-ticket-1', now(), now() + interval '3 days'),
    ('00000000-0000-0000-0000-0000000000a2', 'hash-ticket-2', now(), now() + interval '3 days');

INSERT INTO users (id, ticket_id, email, password_hash, display_name) VALUES
    ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a1',
     'anna@example.org', '$argon2id$v=19$m=65536,t=3,p=4$abc$def', 'Anna'),
    ('00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000a2',
     'bram@example.org', '$argon2id$v=19$m=65536,t=3,p=4$abc$def', 'Bram');

INSERT INTO stages (id, name, latitude, longitude, capacity) VALUES
    ('00000000-0000-0000-0000-0000000000b1', 'Hoofdpodium', 52.37, 4.89, 5000)
ON CONFLICT DO NOTHING;

-- --- tickets -----------------------------------------------------------------
SELECT pg_temp.expect_fail('ticket eindigt voor begin',
    $q$INSERT INTO tickets (code_hash, valid_from, valid_until) VALUES ('x', now(), now() - interval '1 day')$q$);
SELECT pg_temp.expect_fail('dubbele ticketcode',
    $q$INSERT INTO tickets (code_hash, valid_from, valid_until) VALUES ('hash-ticket-1', now(), now() + interval '1 day')$q$);

-- --- users -------------------------------------------------------------------
SELECT pg_temp.expect_fail('wachtwoord niet als argon2id-hash',
    $q$INSERT INTO users (email, password_hash, display_name, role) VALUES ('c@example.org', 'geheim123', 'C', 'organisatie')$q$);
SELECT pg_temp.expect_fail('e-mail dubbel (hoofdletterongevoelig)',
    $q$INSERT INTO users (email, password_hash, display_name, role) VALUES ('ANNA@example.org', '$argon2id$x', 'A2', 'organisatie')$q$);
SELECT pg_temp.expect_fail('ongeldig e-mailadres',
    $q$INSERT INTO users (email, password_hash, display_name, role) VALUES ('geen-email', '$argon2id$x', 'D', 'organisatie')$q$);
SELECT pg_temp.expect_fail('bezoeker zonder ticket',
    $q$INSERT INTO users (email, password_hash, display_name) VALUES ('e@example.org', '$argon2id$x', 'E')$q$);
SELECT pg_temp.expect_fail('twee accounts op één ticket',
    $q$INSERT INTO users (ticket_id, email, password_hash, display_name) VALUES ('00000000-0000-0000-0000-0000000000a1', 'f@example.org', '$argon2id$x', 'F')$q$);
SELECT pg_temp.expect_fail('lege weergavenaam',
    $q$INSERT INTO users (email, password_hash, display_name, role) VALUES ('g@example.org', '$argon2id$x', '', 'organisatie')$q$);

-- --- friend_codes ------------------------------------------------------------
SELECT pg_temp.expect_fail('vriendcode langer dan 15 minuten geldig',
    $q$INSERT INTO friend_codes (user_id, code_hash, expires_at) VALUES ('00000000-0000-0000-0000-000000000001', 'fc1', now() + interval '1 hour')$q$);
SELECT pg_temp.expect_fail('eigen vriendcode gebruiken',
    $q$INSERT INTO friend_codes (user_id, code_hash, expires_at, used_at, used_by) VALUES ('00000000-0000-0000-0000-000000000001', 'fc2', now() + interval '5 minutes', now(), '00000000-0000-0000-0000-000000000001')$q$);

-- --- friendships -------------------------------------------------------------
SELECT pg_temp.expect_fail('vriendschap niet geordend / met jezelf',
    $q$INSERT INTO friendships (user_a, user_b) VALUES ('00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001')$q$);
SELECT pg_temp.expect_fail('vriendschap met jezelf',
    $q$INSERT INTO friendships (user_a, user_b) VALUES ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001')$q$);

-- --- locations ---------------------------------------------------------------
SELECT pg_temp.expect_fail('breedtegraad buiten bereik',
    $q$INSERT INTO locations (user_id, latitude, longitude, expires_at) VALUES ('00000000-0000-0000-0000-000000000001', 91, 4.9, now() + interval '10 minutes')$q$);
SELECT pg_temp.expect_fail('locatie langer dan 1 uur bewaard',
    $q$INSERT INTO locations (user_id, latitude, longitude, expires_at) VALUES ('00000000-0000-0000-0000-000000000001', 52.3, 4.9, now() + interval '1 day')$q$);

-- --- messages ----------------------------------------------------------------
SELECT pg_temp.expect_fail('bericht aan jezelf',
    $q$INSERT INTO messages (sender_id, recipient_id, body) VALUES ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'hoi')$q$);
SELECT pg_temp.expect_fail('leeg bericht',
    $q$INSERT INTO messages (sender_id, recipient_id, body) VALUES ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002', '')$q$);
SELECT pg_temp.expect_fail('bericht te lang',
    $q$INSERT INTO messages (sender_id, recipient_id, body) VALUES ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002', repeat('x', 1001))$q$);

-- --- performances ------------------------------------------------------------
SELECT pg_temp.expect_fail('optreden eindigt voor het begint',
    $q$INSERT INTO performances (stage_id, artist, starts_at, ends_at) VALUES ((SELECT id FROM stages LIMIT 1), 'X', now(), now() - interval '1 hour')$q$);

-- --- push_subscriptions ------------------------------------------------------
SELECT pg_temp.expect_fail('push-endpoint zonder https',
    $q$INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth) VALUES ('00000000-0000-0000-0000-000000000001', 'http://push.example.org/x', 'k', 'a')$q$);

-- --- sos_alerts --------------------------------------------------------------
SELECT pg_temp.expect_fail('SOS met alleen breedtegraad',
    $q$INSERT INTO sos_alerts (user_id, latitude) VALUES ('00000000-0000-0000-0000-000000000001', 52.3)$q$);
SELECT pg_temp.expect_fail('SOS afgehandeld zonder tijdstip',
    $q$INSERT INTO sos_alerts (user_id, status) VALUES ('00000000-0000-0000-0000-000000000001', 'afgehandeld')$q$);

-- --- map_points --------------------------------------------------------------
SELECT pg_temp.expect_fail('kaartpunt zonder naam',
    $q$INSERT INTO map_points (kind, name, latitude, longitude) VALUES ('wifi', '', 52.3, 4.8)$q$);
SELECT pg_temp.expect_fail('kaartpunt met onbekende soort',
    $q$INSERT INTO map_points (kind, name, latitude, longitude) VALUES ('kroeg', 'Bar', 52.3, 4.8)$q$);
SELECT pg_temp.expect_fail('kaartpunt buiten de wereld',
    $q$INSERT INTO map_points (kind, name, latitude, longitude) VALUES ('ehbo', 'EHBO', 95, 4.8)$q$);

-- --- audit_log ---------------------------------------------------------------
INSERT INTO audit_log (actor_id, action) VALUES ('00000000-0000-0000-0000-000000000001', 'auth.login');
SELECT pg_temp.expect_fail('audit_log wijzigen',
    $q$UPDATE audit_log SET action = 'auth.logout'$q$);
SELECT pg_temp.expect_fail('audit_log verwijderen',
    $q$DELETE FROM audit_log$q$);
SELECT pg_temp.expect_fail('audit-actie met verkeerd formaat',
    $q$INSERT INTO audit_log (action) VALUES ('Iets Gedaan')$q$);

ROLLBACK;
