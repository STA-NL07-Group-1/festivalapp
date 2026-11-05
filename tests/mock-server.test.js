// Tests voor de mock-server (tools/mock-server.js)
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { server } from '../tools/mock-server.js';

let base;
const token = { Authorization: 'Bearer test' };
const json = { 'Content-Type': 'application/json' };

beforeAll(async () => {
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  base = `http://127.0.0.1:${server.address().port}`;
});
afterAll(() => new Promise((ok) => server.close(ok)));

describe('mock-server', () => {
  it('geeft een publiek endpoint zonder token', async () => {
    const res = await fetch(`${base}/timetable`);
    expect(res.status).toBe(200);
    expect(Array.isArray(await res.json())).toBe(true);
  });

  it('weigert een beveiligd endpoint zonder token', async () => {
    const res = await fetch(`${base}/friends`);
    expect(res.status).toBe(401);
  });

  it('geeft een beveiligd endpoint met token', async () => {
    const res = await fetch(`${base}/friends`, { headers: token });
    expect(res.status).toBe(200);
  });

  it('controleert het formaat van een vriendcode', async () => {
    const bad = await fetch(`${base}/friends/redeem`, {
      method: 'POST',
      headers: { ...token, ...json },
      body: JSON.stringify({ code: 'abc' }),
    });
    expect(bad.status).toBe(400);

    const good = await fetch(`${base}/friends/redeem`, {
      method: 'POST',
      headers: { ...token, ...json },
      body: JSON.stringify({ code: 'K7P3XQ9M' }),
    });
    expect(good.status).toBe(201);
  });

  it('geeft 400 bij ongeldige JSON', async () => {
    const res = await fetch(`${base}/sos`, { method: 'POST', headers: { ...token, ...json }, body: '{kapot' });
    expect(res.status).toBe(400);
  });

  it('kan een foutcode afdwingen met Prefer', async () => {
    const res = await fetch(`${base}/auth/login`, {
      method: 'POST',
      headers: { ...json, Prefer: 'code=429' },
      body: JSON.stringify({ email: 'a@b.nl', password: 'x' }),
    });
    expect(res.status).toBe(429);
    expect(res.headers.get('retry-after')).toBe('60');
  });

  it('geeft 404 voor een onbekend endpoint', async () => {
    const res = await fetch(`${base}/bestaat-niet`);
    expect(res.status).toBe(404);
  });

  it('staat CORS alleen toe vanaf localhost', async () => {
    const local = await fetch(`${base}/friends`, { method: 'OPTIONS', headers: { Origin: 'http://localhost:5173' } });
    expect(local.headers.get('access-control-allow-origin')).toBe('http://localhost:5173');

    const other = await fetch(`${base}/friends`, { method: 'OPTIONS', headers: { Origin: 'https://evil.example' } });
    expect(other.headers.get('access-control-allow-origin')).toBeNull();
  });
});