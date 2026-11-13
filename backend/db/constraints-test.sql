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
-- Het eerste festival bestaat al (migratie 0004); hier komt een tweede bij
INSERT INTO festivals (id, name, starts_at, ends_at) VALUES
    ('00000000-0000-4000-8000-0000000000f2', 'Tweede festival', now(), now() + interval '3 days');

INSERT INTO users (id, email, password_hash, display_name) VALUES
    ('00000000-0000-0000-0000-000000000001', 'anna@example.org', '$argon2id$v=19$m=65536,t=3,p=4$abc$def', 'Anna'),
    ('00000000-0000-0000-0000-000000000002', 'bram@example.org', '$argon2id$v=19$m=65536,t=3,p=4$abc$def', 'Bram');

INSERT INTO tickets (id, festival_id, user_id, status, code_hash, valid_from, valid_until) VALUES
    ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000001', 'gekoppeld', 'hash-ticket-1', now(), now() + interval '3 days'),
    ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000002', 'gekoppeld', 'hash-ticket-2', now(), now() + interval '3 days');

INSERT INTO stages (id, festival_id, name, latitude, longitude, capacity) VALUES
    ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-4000-8000-000000000001', 'Hoofdpodium', 52.37, 4.89, 5000)
ON CONFLICT DO NOTHING;

-- --- tickets -----------------------------------------------------------------
SELECT pg_temp.expect_fail('ticket eindigt voor begin',
    $q$INSERT INTO tickets (festival_id, code_hash, valid_from, valid_until) VALUES ('00000000-0000-4000-8000-000000000001', 'x', now(), now() - interval '1 day')$q$);
SELECT pg_temp.expect_fail('dubbele ticketcode',
    $q$INSERT INTO tickets (festival_id, code_hash, valid_from, valid_until) VALUES ('00000000-0000-4000-8000-000000000001', 'hash-ticket-1', now(), now() + interval '1 day')$q$);

-- --- users -------------------------------------------------------------------
SELECT pg_temp.expect_fail('wachtwoord niet als argon2id-hash',
    $q$INSERT INTO users (email, password_hash, display_name) VALUES ('c@example.org', 'geheim123', 'C')$q$);
SELECT pg_temp.expect_fail('e-mail dubbel (hoofdletterongevoelig)',
    $q$INSERT INTO users (email, password_hash, display_name) VALUES ('ANNA@example.org', '$argon2id$x', 'A2')$q$);
SELECT pg_temp.expect_fail('ongeldig e-mailadres',
    $q$INSERT INTO users (email, password_hash, display_name) VALUES ('geen-email', '$argon2id$x', 'D')$q$);
SELECT pg_temp.expect_fail('twee tickets van hetzelfde festival op één account',
    $q$INSERT INTO tickets (festival_id, user_id, code_hash, valid_from, valid_until) VALUES ('00000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000001', 'hash-ticket-3', now(), now() + interval '1 day')$q$);
SELECT pg_temp.expect_fail('lege weergavenaam',
    $q$INSERT INTO users (email, password_hash, display_name) VALUES ('g@example.org', '$argon2id$x', '')$q$);

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
    $q$INSERT INTO locations (user_id, festival_id, latitude, longitude, expires_at) VALUES ('00000000-0000-0000-0000-000000000001', '00000000-0000-4000-8000-000000000001', 91, 4.9, now() + interval '10 minutes')$q$);
SELECT pg_temp.expect_fail('locatie langer dan 1 uur bewaard',
    $q$INSERT INTO locations (user_id, festival_id, latitude, longitude, expires_at) VALUES ('00000000-0000-0000-0000-000000000001', '00000000-0000-4000-8000-000000000001', 52.3, 4.9, now() + interval '1 day')$q$);

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
    $q$INSERT INTO sos_alerts (festival_id, user_id, latitude) VALUES ('00000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000001', 52.3)$q$);
SELECT pg_temp.expect_fail('SOS afgehandeld zonder tijdstip',
    $q$INSERT INTO sos_alerts (festival_id, user_id, status) VALUES ('00000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000001', 'afgehandeld')$q$);

-- --- users: blokkeren ---------------------------------------------------------
SELECT pg_temp.expect_fail('geblokkeerd zonder reden',
    $q$UPDATE users SET blocked_at = now() WHERE id = '00000000-0000-0000-0000-000000000001'$q$);
SELECT pg_temp.expect_fail('reden zonder blokkade',
    $q$UPDATE users SET blocked_reason = 'Incident' WHERE id = '00000000-0000-0000-0000-000000000001'$q$);

-- --- map_points --------------------------------------------------------------
SELECT pg_temp.expect_fail('kaartpunt zonder naam',
    $q$INSERT INTO map_points (festival_id, kind, name, latitude, longitude) VALUES ('00000000-0000-4000-8000-000000000001', 'wifi', '', 52.3, 4.8)$q$);
SELECT pg_temp.expect_fail('kaartpunt met onbekende soort',
    $q$INSERT INTO map_points (festival_id, kind, name, latitude, longitude) VALUES ('00000000-0000-4000-8000-000000000001', 'kroeg', 'Bar', 52.3, 4.8)$q$);
SELECT pg_temp.expect_fail('kaartpunt buiten de wereld',
    $q$INSERT INTO map_points (festival_id, kind, name, latitude, longitude) VALUES ('00000000-0000-4000-8000-000000000001', 'ehbo', 'EHBO', 95, 4.8)$q$);

-- --- festivals en rollen ---------------------------------------------------
SELECT pg_temp.expect_fail('festival eindigt voor het begint',
    $q$INSERT INTO festivals (name, starts_at, ends_at) VALUES ('Fout', now(), now() - interval '1 day')$q$);
SELECT pg_temp.expect_fail('festival zonder naam',
    $q$INSERT INTO festivals (name, starts_at, ends_at) VALUES ('', now(), now() + interval '1 day')$q$);
SELECT pg_temp.expect_fail('twee podia met dezelfde naam op één festival',
    $q$INSERT INTO stages (festival_id, name, latitude, longitude, capacity) VALUES ('00000000-0000-4000-8000-000000000001', 'Hoofdpodium', 52.37, 4.89, 100)$q$);
-- Dezelfde podiumnaam op een ander festival mag wel
INSERT INTO stages (festival_id, name, latitude, longitude, capacity) VALUES
    ('00000000-0000-4000-8000-0000000000f2', 'Hoofdpodium', 52.11, 4.28, 100);
SELECT pg_temp.expect_fail('podium zonder festival',
    $q$INSERT INTO stages (name, latitude, longitude, capacity) VALUES ('Los podium', 52.37, 4.89, 100)$q$);
SELECT pg_temp.expect_fail('onbekende rol bij een festival',
    $q$INSERT INTO festival_members (festival_id, user_id, role) VALUES ('00000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000001', 'bezoeker')$q$);
INSERT INTO festival_members (festival_id, user_id, role) VALUES ('00000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000001', 'ehbo');
SELECT pg_temp.expect_fail('twee rollen bij hetzelfde festival',
    $q$INSERT INTO festival_members (festival_id, user_id, role) VALUES ('00000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000001', 'beveiliging')$q$);
UPDATE users SET platform_role = NULL WHERE platform_role = 'sudo';
UPDATE users SET platform_role = 'sudo' WHERE id = '00000000-0000-0000-0000-000000000001';
SELECT pg_temp.expect_fail('tweede sudo-account',
    $q$UPDATE users SET platform_role = 'sudo' WHERE id = '00000000-0000-0000-0000-000000000002'$q$);
SELECT pg_temp.expect_fail('festivalblokkade zonder reden',
    $q$INSERT INTO festival_blocks (festival_id, user_id, reason) VALUES ('00000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000002', '')$q$);

-- --- festivalinformatie ----------------------------------------------------
SELECT pg_temp.expect_fail('vraag zonder tekst',
    $q$INSERT INTO faq_items (festival_id, question_nl, question_en, answer_nl, answer_en) VALUES ('00000000-0000-4000-8000-000000000001', '', 'Q', 'A', 'A')$q$);
SELECT pg_temp.expect_fail('huisregels te lang',
    $q$UPDATE festivals SET house_rules_nl = repeat('x', 5001) WHERE id = '00000000-0000-4000-8000-000000000001'$q$);
SELECT pg_temp.expect_fail('plattegrond als svg',
    $q$INSERT INTO site_maps (festival_id, content_type, data) VALUES ('00000000-0000-4000-8000-000000000001', 'image/svg+xml', '\x3c737667')$q$);
SELECT pg_temp.expect_fail('lege plattegrond',
    $q$INSERT INTO site_maps (festival_id, content_type, data) VALUES ('00000000-0000-4000-8000-000000000001', 'image/png', '')$q$);
SELECT pg_temp.expect_fail('gevonden voorwerp zonder omschrijving',
    $q$INSERT INTO lost_items (festival_id, description) VALUES ('00000000-0000-4000-8000-000000000001', '')$q$);
SELECT pg_temp.expect_fail('opgehaald zonder tijdstip',
    $q$INSERT INTO lost_items (festival_id, description, status) VALUES ('00000000-0000-4000-8000-000000000001', 'Zwarte jas', 'opgehaald')$q$);

-- --- maillinks ---------------------------------------------------------------
SELECT pg_temp.expect_fail('maillink verloopt voor hij gemaakt is',
    $q$INSERT INTO email_tokens (user_id, purpose, token_hash, expires_at) VALUES ('00000000-0000-0000-0000-000000000001', 'reset', repeat('a', 64), now() - interval '1 minute')$q$);
SELECT pg_temp.expect_fail('resetlink langer dan 1 uur geldig',
    $q$INSERT INTO email_tokens (user_id, purpose, token_hash, expires_at) VALUES ('00000000-0000-0000-0000-000000000001', 'reset', repeat('b', 64), now() + interval '2 hours')$q$);
SELECT pg_temp.expect_fail('maillink als leesbare token in plaats van hash',
    $q$INSERT INTO email_tokens (user_id, purpose, token_hash, expires_at) VALUES ('00000000-0000-0000-0000-000000000001', 'verify', 'geheime-token', now() + interval '1 day')$q$);
INSERT INTO email_tokens (user_id, purpose, token_hash, expires_at) VALUES ('00000000-0000-0000-0000-000000000001', 'verify', repeat('c', 64), now() + interval '1 day');
SELECT pg_temp.expect_fail('dubbele maillink',
    $q$INSERT INTO email_tokens (user_id, purpose, token_hash, expires_at) VALUES ('00000000-0000-0000-0000-000000000002', 'verify', repeat('c', 64), now() + interval '1 day')$q$);

-- --- audit_log ---------------------------------------------------------------
INSERT INTO audit_log (actor_id, action) VALUES ('00000000-0000-0000-0000-000000000001', 'auth.login');
SELECT pg_temp.expect_fail('audit_log wijzigen',
    $q$UPDATE audit_log SET action = 'auth.logout'$q$);
SELECT pg_temp.expect_fail('audit_log verwijderen',
    $q$DELETE FROM audit_log$q$);
SELECT pg_temp.expect_fail('audit-actie met verkeerd formaat',
    $q$INSERT INTO audit_log (action) VALUES ('Iets Gedaan')$q$);

ROLLBACK;
