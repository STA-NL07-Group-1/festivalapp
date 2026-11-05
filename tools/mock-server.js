// Mock-server op basis van docs/api.yaml.
// Start met: npm run mock  →  http://localhost:4010
//
// Wat hij doet:
// - Geeft voor elk endpoint uit api.yaml een voorbeeldantwoord, gemaakt uit de schema's.
// - Zonder "Authorization: Bearer <iets>" krijg je 401 op endpoints waarvoor je moet inloggen.
// - Controleert verplichte velden, lengte en patronen van de velden in de request body (400).
// - Met de header "Prefer: code=429" (of een andere gedocumenteerde code) krijg je dat antwoord,
//   handig om foutschermen te testen.
// - Luistert alleen op je eigen computer (127.0.0.1), niet op het netwerk.
//
// Niet: echte data opslaan of WebSockets. Dat doet de echte backend.
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { parse } from 'yaml';
import OpenAPISampler from 'openapi-sampler';

const PORT = Number(process.env.MOCK_PORT ?? 4010);
const HOST = '127.0.0.1';
const MAX_BODY = 100 * 1024; // 100 kB
const METHODS = ['get', 'post', 'put', 'patch', 'delete'];

const api = parse(readFileSync(new URL('../docs/api.yaml', import.meta.url), 'utf8'));

const resolve = (obj) =>
  obj?.$ref ? resolve(obj.$ref.split('/').slice(1).reduce((o, k) => o[k], api)) : obj;

// Paden als /friends/{friendId} omzetten naar een reguliere expressie
const routes = Object.entries(api.paths).flatMap(([path, item]) =>
  METHODS.filter((m) => item[m]).map((method) => ({
    method: method.toUpperCase(),
    path,
    regex: new RegExp('^' + path.replace(/\{[^}]+\}/g, '[^/]+') + '/?$'),
    op: item[method],
  })),
);

const isPublic = (op) => Array.isArray(op.security) && op.security.length === 0;

function sample(response) {
  const schema = resolve(response)?.content?.['application/json']?.schema;
  return schema ? OpenAPISampler.sample(schema, { skipReadOnly: true }, api) : undefined;
}

function validateBody(op, body) {
  const rb = resolve(op.requestBody);
  if (!rb) return null;
  const schema = resolve(rb.content?.['application/json']?.schema);
  if (body === undefined) return rb.required ? 'Request body ontbreekt' : null;
  if (!schema || typeof body !== 'object' || body === null) return 'Request body moet een JSON-object zijn';
  for (const field of schema.required ?? []) {
    if (body[field] === undefined) return `Veld "${field}" is verplicht`;
  }
  for (const [name, raw] of Object.entries(schema.properties ?? {})) {
    const prop = resolve(raw);
    const value = body[name];
    if (value === undefined || typeof value !== 'string') continue;
    if (prop.minLength !== undefined && value.length < prop.minLength) return `"${name}" is te kort`;
    if (prop.maxLength !== undefined && value.length > prop.maxLength) return `"${name}" is te lang`;
    if (prop.pattern && !new RegExp(prop.pattern).test(value)) return `"${name}" heeft een ongeldig formaat`;
    if (prop.enum && !prop.enum.includes(value)) return `"${name}" heeft een ongeldige waarde`;
  }
  return null;
}

function send(res, status, data) {
  if (data === undefined) {
    res.writeHead(status).end();
  } else {
    res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(data, null, 2));
  }
}

// Alleen de Vite-dev-server (5173) en Vite-preview (4173) op je eigen computer mogen de mock aanroepen
const ALLOWED_ORIGINS = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:4173',
  'http://127.0.0.1:4173',
];

function cors(req, res) {
  const allowed = ALLOWED_ORIGINS.find((o) => o === req.headers.origin);
  if (allowed) {
    res.setHeader('Access-Control-Allow-Origin', allowed);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, Prefer');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  }
}

function readBody(req) {
  return new Promise((ok, fail) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        fail(new Error('too_large'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => ok(chunks.length ? Buffer.concat(chunks).toString('utf8') : ''));
    req.on('error', fail);
  });
}

const error = (code, message) => ({ code, message });

export const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://${HOST}`);
  const start = Date.now();
  res.on('finish', () =>
    process.env.VITEST || console.log(`${req.method} ${url.pathname} → ${res.statusCode} (${Date.now() - start} ms)`),
  );

  cors(req, res);
  if (req.method === 'OPTIONS') return send(res, 204);

  const route = routes.find((r) => r.method === req.method && r.regex.test(url.pathname));
  if (!route) return send(res, 404, error('not_found', `Geen endpoint ${req.method} ${url.pathname} in api.yaml`));
  const { op } = route;

  // Inloggen verplicht?
  const auth = req.headers.authorization ?? '';
  if (!isPublic(op) && !/^Bearer \S+$/.test(auth)) {
    return send(res, 401, error('unauthorized', 'Niet ingelogd: stuur een header "Authorization: Bearer <token>"'));
  }

  // Request body
  let body;
  try {
    const raw = await readBody(req);
    body = raw ? JSON.parse(raw) : undefined;
  } catch (e) {
    return e.message === 'too_large'
      ? send(res, 413, error('too_large', 'Request body is te groot'))
      : send(res, 400, error('invalid_json', 'Request body is geen geldige JSON'));
  }
  const problem = validateBody(op, body);
  if (problem) return send(res, 400, error('invalid_input', problem));

  // Een bepaalde statuscode afdwingen met "Prefer: code=429"
  const codes = Object.keys(op.responses);
  const preferred = /code=(\d{3})/.exec(req.headers.prefer ?? '')?.[1];
  if (preferred) {
    if (!codes.includes(preferred)) {
      return send(res, 400, error('unknown_code', `Code ${preferred} staat niet bij dit endpoint; kies uit ${codes.join(', ')}`));
    }
    if (preferred === '429') res.setHeader('Retry-After', '60');
    return send(res, Number(preferred), sample(op.responses[preferred]));
  }

  const success = codes.filter((c) => c.startsWith('2')).sort()[0] ?? '200';
  return send(res, Number(success), sample(op.responses[success]));
});

// Alleen starten als dit bestand direct wordt uitgevoerd (niet bij importeren in een test)
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  server.listen(PORT, HOST, () => {
    console.log(`Mock-server draait op http://localhost:${PORT} (${routes.length} endpoints uit docs/api.yaml)`);
    console.log('Tip: stuur "Authorization: Bearer test" mee voor endpoints waarvoor je moet inloggen.');
  });
}