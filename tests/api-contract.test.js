// Contracttests op docs/api.yaml.
// Deze tests bewaken de security-afspraken in de API. Faalt er een, dan is dat een bewuste
// beslissing die met Cyber Security (Gijs) besproken moet worden, geen fout om weg te poetsen.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const api = parse(readFileSync(new URL('../docs/api.yaml', import.meta.url), 'utf8'));
const METHODS = ['get', 'post', 'put', 'patch', 'delete'];

const operations = Object.entries(api.paths).flatMap(([path, item]) =>
  METHODS.filter((m) => item[m]).map((method) => ({
    path,
    method,
    key: `${method.toUpperCase()} ${path}`,
    op: item[method],
    params: [...(item.parameters ?? []), ...(item[method].parameters ?? [])],
  })),
);

const isPublic = ({ op }) => Array.isArray(op.security) && op.security.length === 0;
const resolve = (obj) =>
  obj?.$ref ? obj.$ref.split('/').slice(1).reduce((o, k) => o[k], api) : obj;

// Endpoints die zonder inloggen bereikbaar mogen zijn. Nieuwe toevoegen = eerst overleggen.
const PUBLIC_ENDPOINTS = [
  'POST /auth/register',
  'POST /auth/login',
  'POST /auth/refresh',
  'GET /timetable',
  'GET /announcements',
];

// Endpoints die misbruikt kunnen worden door veel verzoeken (raden, spammen) en dus rate limiting hebben.
const RATE_LIMITED = ['POST /auth/login', 'POST /friends/codes', 'POST /friends/redeem', 'POST /sos'];

describe('API-contract: basis', () => {
  it('is OpenAPI 3.1', () => {
    expect(api.openapi).toMatch(/^3\.1\./);
  });

  it('gebruikt alleen HTTPS, behalve voor localhost', () => {
    for (const { url } of api.servers) {
      expect(url, url).toMatch(/^(https:\/\/|http:\/\/localhost(:\d+)?\/?)/);
    }
  });

  it.each(operations.map((o) => [o.key, o]))('%s heeft een operationId, summary en tag', (_, { op }) => {
    expect(op.operationId).toBeTruthy();
    expect(op.summary).toBeTruthy();
    expect(op.tags?.length).toBeGreaterThan(0);
  });
});

describe('API-contract: security', () => {
  it('standaard is voor elk endpoint inloggen verplicht', () => {
    expect(api.security).toEqual([{ bearerAuth: [] }]);
  });

  it('alleen de afgesproken endpoints zijn publiek', () => {
    const publicKeys = operations.filter(isPublic).map((o) => o.key).sort();
    expect(publicKeys).toEqual([...PUBLIC_ENDPOINTS].sort());
  });

  it.each(operations.filter((o) => !isPublic(o)).map((o) => [o.key, o]))(
    '%s geeft 401 als je niet bent ingelogd',
    (_, { op }) => {
      expect(Object.keys(op.responses)).toContain('401');
    },
  );

  it.each(operations.filter((o) => o.path.startsWith('/admin/')).map((o) => [o.key, o]))(
    '%s (beheer) geeft 403 zonder de juiste rol',
    (_, { op }) => {
      expect(Object.keys(op.responses)).toContain('403');
    },
  );

  it.each(RATE_LIMITED.map((k) => [k]))('%s heeft rate limiting (429)', (key) => {
    const found = operations.find((o) => o.key === key);
    expect(found, `${key} bestaat niet meer in api.yaml`).toBeDefined();
    expect(Object.keys(found.op.responses)).toContain('429');
  });

  it('ID\'s in URL\'s zijn UUID\'s, zodat ze niet op volgorde te raden zijn', () => {
    const idParams = operations.flatMap((o) =>
      o.params.map(resolve).filter((p) => p.in === 'path').map((p) => ({ key: o.key, p })),
    );
    expect(idParams.length).toBeGreaterThan(0);
    for (const { key, p } of idParams) {
      expect(p.schema?.format, `${key}: ${p.name}`).toBe('uuid');
    }
  });

  it('wachtwoorden zijn minimaal 12 en maximaal 128 tekens', () => {
    for (const path of ['/auth/register', '/auth/login']) {
      const pw = api.paths[path].post.requestBody.content['application/json'].schema.properties.password;
      if (path === '/auth/register') expect(pw.minLength).toBeGreaterThanOrEqual(12);
      expect(pw.maxLength, path).toBeLessThanOrEqual(128);
    }
  });

  it('vriendcodes hebben een vast formaat zonder verwarrende tekens (0/O, 1/I)', () => {
    const code =
      api.paths['/friends/redeem'].post.requestBody.content['application/json'].schema.properties.code;
    expect(code.pattern).toBe('^[A-HJ-NP-Z2-9]{8}$');
  });

  it('vrije tekstvelden hebben een maximale lengte', () => {
    const fields = [
      ['/chats/{friendId}/messages', 'post', 'text'],
      ['/admin/announcements', 'post', 'body'],
      ['/sos', 'post', 'note'],
    ];
    for (const [path, method, field] of fields) {
      const prop = api.paths[path][method].requestBody.content['application/json'].schema.properties[field];
      expect(prop.maxLength, `${path} ${field}`).toBeGreaterThan(0);
    }
  });

  it('noodberichten hebben een handtekening, zodat de app kan controleren dat ze echt zijn', () => {
    expect(api.components.schemas.Announcement.properties.signature).toBeDefined();
  });
});