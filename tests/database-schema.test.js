// Controleert of de database-migratie past bij docs/api.yaml en docs/security-eisen.md.
// Dit test de tekst van de migratie. De regels zelf staan in backend/db/constraints-test.sql.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const api = parse(readFileSync(new URL('../docs/api.yaml', import.meta.url), 'utf8'));
const sql = readFileSync(new URL('../backend/db/migrations/0001_init.sql', import.meta.url), 'utf8');
const schemas = api.components.schemas;

const tables = [...sql.matchAll(/CREATE TABLE (\w+) \((.*?)\n\);/gs)].map(([, name, body]) => ({ name, body }));
const table = (name) => tables.find((t) => t.name === name).body;
const allowed = (name, column) => {
  const match = table(name).match(new RegExp(`${column} IN \\(([^)]*)\\)`));
  return match[1].split(',').map((value) => value.trim().replaceAll("'", ''));
};

describe('Database-schema', () => {
  it('gebruikt alleen UUID-ID\'s', () => {
    expect(sql).not.toMatch(/\b(BIGINT|SERIAL|IDENTITY)\b/i);
    for (const { name, body } of tables) {
      if (/^\s*id\s/m.test(body)) expect(body, name).toMatch(/^\s*id\s+UUID PRIMARY KEY/m);
    }
  });

  it('heeft dezelfde waarden als de API', () => {
    expect(allowed('users', 'role')).toEqual(schemas.User.properties.role.enum);
    expect(allowed('performances', 'status')).toEqual(schemas.Slot.properties.status.enum);
    expect(allowed('announcements', 'type')).toEqual(schemas.Announcement.properties.type.enum);
    expect(allowed('sos_reports', 'type')).toEqual(schemas.SosReport.properties.type.enum);
    expect(allowed('sos_reports', 'status')).toEqual(schemas.SosReport.properties.status.enum);
  });

  it('bewaart geheimen alleen als hash', () => {
    expect(table('users')).toMatch(/password_hash/);
    expect(table('refresh_tokens')).toMatch(/token_hash/);
    expect(table('friend_codes')).toMatch(/code_hash/);
    expect(table('tickets')).toMatch(/invite_token_hash/);
    expect(sql).not.toMatch(/^\s*(password|token|code|invite_token)\s+TEXT/m);
  });

  it('zet locatie delen standaard uit', () => {
    expect(table('users')).toMatch(/location_sharing_enabled BOOLEAN NOT NULL DEFAULT false/);
  });

  it('bewaart maar 1 locatie per gebruiker', () => {
    expect(table('user_locations')).toMatch(/user_id\s+UUID PRIMARY KEY/);
  });
});
