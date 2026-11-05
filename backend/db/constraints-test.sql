-- Handmatige test van de regels in de database. Draai dit op een lege testdatabase, na 0001_init.sql:
--   psql -d festivalapp_test -f backend/db/constraints-test.sql
-- Elke regel met EXPECT_FAIL moet een fout geven.
\set ON_ERROR_STOP off
\set a '''00000000-0000-4000-8000-00000000000a'''
\set b '''00000000-0000-4000-8000-00000000000b'''
INSERT INTO users (id, username, email, password_hash) VALUES (:a, 'bob', 'a@test.nl', 'x'), (:b, 'niek', 'b@test.nl', 'x');
\echo EXPECT_FAIL dubbele gebruikersnaam
INSERT INTO users (username, email, password_hash) VALUES ('BOB', 'c@test.nl', 'x');
\echo EXPECT_FAIL onbekende rol
INSERT INTO users (username, email, password_hash, role) VALUES ('sam', 'd@test.nl', 'x', 'admin');
INSERT INTO festivals (id, name, starts_at, ends_at) VALUES ('00000000-0000-4000-8000-000000000001', 'Nu', now() - interval '1 hour', now() + interval '1 day');
\set f '''00000000-0000-4000-8000-000000000001'''
INSERT INTO tickets (festival_id, external_reference, email, invite_token_hash, invite_expires_at, user_id, claimed_at)
VALUES (:f, 'T1', 'a@test.nl', 'h1', now(), :a, now()), (:f, 'T2', 'b@test.nl', 'h2', now(), :b, now());
\echo EXPECT_FAIL tweede ticket op hetzelfde festival
INSERT INTO tickets (festival_id, external_reference, email, invite_token_hash, invite_expires_at, user_id, claimed_at)
VALUES (:f, 'T3', 'a@test.nl', 'h3', now(), :a, now());
\echo EXPECT_FAIL vriendcode te lang geldig
INSERT INTO friend_codes (user_id, code_hash, expires_at) VALUES (:a, 'c1', now() + interval '11 minutes');
\echo EXPECT_FAIL verkeerde volgorde vriendschap
INSERT INTO friendships VALUES (:b, :a);
INSERT INTO friendships VALUES (:a, :b);
\echo EXPECT_1 vrienden actief op hetzelfde festival
SELECT count(*) FROM active_friendships;
UPDATE tickets SET checked_out_at = now() WHERE external_reference = 'T2';
\echo EXPECT_0 na vertrek van een vriend
SELECT count(*) FROM active_friendships;
\echo EXPECT_FAIL bericht te lang
INSERT INTO messages (client_message_id, festival_id, sender_id, receiver_id, body) VALUES (gen_random_uuid(), :f, :a, :b, repeat('x', 1001));
INSERT INTO messages (client_message_id, festival_id, sender_id, receiver_id, body) VALUES ('11111111-1111-4111-8111-111111111111', :f, :a, :b, 'hoi');
\echo EXPECT_FAIL dubbel bericht
INSERT INTO messages (client_message_id, festival_id, sender_id, receiver_id, body) VALUES ('11111111-1111-4111-8111-111111111111', :f, :a, :b, 'hoi');
\echo EXPECT_FAIL noodbericht zonder handtekening
INSERT INTO announcements (festival_id, type, title, body) VALUES (:f, 'nood', 'Let op', 'Tekst');
INSERT INTO stages (id, festival_id, name, latitude, longitude) VALUES ('00000000-0000-4000-8000-000000000002', :f, 'Main', 51.4, 5.4);
INSERT INTO acts (id, name) VALUES ('00000000-0000-4000-8000-000000000003', 'X'), ('00000000-0000-4000-8000-000000000004', 'Y');
INSERT INTO performances (act_id, stage_id, starts_at, ends_at) VALUES ('00000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000002', '2026-06-01 20:00+02', '2026-06-01 21:00+02');
\echo EXPECT_FAIL overlap op een podium
INSERT INTO performances (act_id, stage_id, starts_at, ends_at) VALUES ('00000000-0000-4000-8000-000000000004', '00000000-0000-4000-8000-000000000002', '2026-06-01 20:30+02', '2026-06-01 21:30+02');
INSERT INTO sos_reports (festival_id, user_id, type, latitude, longitude) VALUES (:f, :a, 'medisch', 51.4, 5.4);
INSERT INTO user_locations (user_id, festival_id, latitude, longitude, recorded_at) VALUES (:a, :f, 51.4, 5.4, now());
DELETE FROM users WHERE id = :a;
\echo EXPECT_0_0_1 na verwijderen account: berichten, locaties, SOS zonder gebruiker
SELECT (SELECT count(*) FROM messages), (SELECT count(*) FROM user_locations), (SELECT count(*) FROM sos_reports WHERE user_id IS NULL);
