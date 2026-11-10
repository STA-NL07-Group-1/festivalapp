// Integratietests: echte HTTP-verzoeken tegen de echte backend en een echte PostgreSQL.
// Nodig: TEST_DATABASE_URL (een LEGE database; hij wordt bij elke run leeggemaakt).
//   TEST_DATABASE_URL=postgres://festivalapp:festivalapp@localhost:5432/festivalapp_test npm test -w backend
import { createHash } from 'node:crypto'
import type { AddressInfo } from 'node:net'
import pg from 'pg'
import { WebSocket } from 'ws'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createApp, createHttpServer } from '../src/app.ts'
import { loadConfig } from '../src/config.ts'
import { createPool } from '../src/db.ts'
import { createPush } from '../src/push.ts'
import { attachRealtime } from '../src/realtime.ts'
import { migrate } from '../scripts/migrate.ts'
import { DEMO_PASSWORD, seed } from '../scripts/seed.ts'

const databaseUrl = process.env.TEST_DATABASE_URL
const IOT_KEY = 'sensor-geheim-voor-tests'

let base = ''
let close: () => Promise<void> = async () => {}

async function resetDatabase(url: string) {
  const client = new pg.Client({ connectionString: url })
  await client.connect()
  await client.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;')
  await client.end()
  await migrate(url, () => {})
  await seed(url, () => {})
}

beforeAll(async () => {
  if (!databaseUrl) return
  process.env.TRUST_PROXY = '1'
  await resetDatabase(databaseUrl)
  const config = loadConfig({
    env: 'test',
    databaseUrl,
    corsOrigins: ['http://localhost:5173'],
    iotDeviceKeys: new Map([[createHash('sha256').update(IOT_KEY).digest('hex'), 'test-sensor']]),
  })
  const db = createPool(databaseUrl)
  const { handler, deps } = createApp({ db, config, push: createPush(db, null) })
  const server = createHttpServer(handler)
  deps.realtime = attachRealtime(server, { jwtSecret: config.jwtSecret, corsOrigins: config.corsOrigins })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  close = async () => {
    deps.realtime.close()
    await new Promise((resolve) => server.close(resolve))
    await db.end()
  }
})

afterAll(async () => {
  await close()
})

interface Res<T = any> {
  status: number
  body: T
  headers: Headers
}

async function api<T = any>(method: string, path: string, options: { token?: string; body?: unknown; headers?: Record<string, string> } = {}): Promise<Res<T>> {
  // Elk verzoek een eigen "IP", zodat de rate limits per IP de andere tests niet raken
  const headers: Record<string, string> = { 'X-Forwarded-For': `10.0.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`, ...options.headers }
  if (options.token) headers.Authorization = `Bearer ${options.token}`
  if (options.body !== undefined) headers['Content-Type'] = 'application/json'
  const res = await fetch(base + path, {
    method,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  })
  const text = await res.text()
  return { status: res.status, body: text ? JSON.parse(text) : undefined, headers: res.headers }
}

const login = async (email: string, password = DEMO_PASSWORD) => {
  const res = await api('POST', '/auth/login', { body: { email, password } })
  expect(res.status).toBe(200)
  return res.body as { accessToken: string; refreshToken: string }
}

let ticketCounter = 1
async function register(name: string) {
  const ticketCode = `DEMO-${String(ticketCounter++).padStart(4, '0')}`
  const res = await api('POST', '/auth/register', {
    body: { ticketCode, email: `${name.toLowerCase()}@test.nl`, password: 'een-heel-sterk-wachtwoord', displayName: name },
  })
  expect(res.status, JSON.stringify(res.body)).toBe(201)
  const me = await api('GET', '/me', { token: res.body.accessToken })
  return { ...res.body, id: me.body.id as string, ticketCode }
}

async function befriend(a: { accessToken: string }, b: { accessToken: string }) {
  const code = await api('POST', '/friend-codes', { token: a.accessToken })
  expect(code.status).toBe(201)
  const added = await api('POST', '/friends', { token: b.accessToken, body: { code: code.body.code } })
  expect(added.status).toBe(201)
}

describe.skipIf(!databaseUrl)('backend', () => {
  describe('systeem', () => {
    it('health-check werkt zonder login', async () => {
      const res = await api('GET', '/health')
      expect(res.status).toBe(200)
      expect(res.body).toEqual({ status: 'ok' })
      expect(res.headers.get('x-content-type-options')).toBe('nosniff')
    })

    it('onbekende routes geven 404, verkeerde methode 405', async () => {
      expect((await api('GET', '/bestaat-niet')).status).toBe(404)
      expect((await api('DELETE', '/health')).status).toBe(405)
    })

    it('CORS alleen voor toegestane origins', async () => {
      const ok = await api('GET', '/health', { headers: { Origin: 'http://localhost:5173' } })
      expect(ok.headers.get('access-control-allow-origin')).toBe('http://localhost:5173')
      const evil = await api('GET', '/health', { headers: { Origin: 'https://evil.example' } })
      expect(evil.headers.get('access-control-allow-origin')).toBeNull()
    })
  })

  describe('accounts', () => {
    it('registreren met een geldig ticket', async () => {
      const user = await register('Charlie')
      const me = await api('GET', '/me', { token: user.accessToken })
      expect(me.body).toMatchObject({ displayName: 'Charlie', role: 'bezoeker', shareLocation: false, shareTimetable: false })
      expect(me.body).not.toHaveProperty('passwordHash')
    })

    it('een ticket werkt maar één keer, en een onbekend ticket niet', async () => {
      const first = await register('Dirk')
      const again = await api('POST', '/auth/register', {
        body: { ticketCode: first.ticketCode, email: 'ander@test.nl', password: 'een-heel-sterk-wachtwoord', displayName: 'X' },
      })
      expect(again.status).toBe(409)
      const unknown = await api('POST', '/auth/register', {
        body: { ticketCode: 'NEP-12345678', email: 'nep@test.nl', password: 'een-heel-sterk-wachtwoord', displayName: 'X' },
      })
      expect(unknown.status).toBe(409)
    })

    it('weigert korte en zwakke wachtwoorden', async () => {
      const short = await api('POST', '/auth/register', {
        body: { ticketCode: 'DEMO-0040', email: 'kort@test.nl', password: 'kort', displayName: 'X' },
      })
      expect(short.status).toBe(400)
      const weak = await api('POST', '/auth/register', {
        body: { ticketCode: 'DEMO-0040', email: 'zwak@test.nl', password: 'wachtwoord123', displayName: 'X' },
      })
      expect(weak.status).toBe(400)
    })

    it('verkeerd wachtwoord geeft dezelfde melding als onbekend e-mailadres', async () => {
      const wrong = await api('POST', '/auth/login', { body: { email: 'anna@festival.test', password: 'fout-fout-fout' } })
      const unknown = await api('POST', '/auth/login', { body: { email: 'niemand@festival.test', password: 'fout-fout-fout' } })
      expect(wrong.status).toBe(401)
      expect(unknown.status).toBe(401)
      expect(wrong.body.message).toBe(unknown.body.message)
    })

    it('refresh-token roteert, en hergebruik trekt alle sessies in', async () => {
      const tokens = await login('bram@festival.test')
      const first = await api('POST', '/auth/refresh', { body: { refreshToken: tokens.refreshToken } })
      expect(first.status).toBe(200)
      const reuse = await api('POST', '/auth/refresh', { body: { refreshToken: tokens.refreshToken } })
      expect(reuse.status).toBe(401)
      // Ook het nieuwe token is nu ingetrokken
      const after = await api('POST', '/auth/refresh', { body: { refreshToken: first.body.refreshToken } })
      expect(after.status).toBe(401)
    })

    it('zonder of met een vals token: 401', async () => {
      expect((await api('GET', '/me')).status).toBe(401)
      expect((await api('GET', '/me', { token: 'eyJhbGciOiJub25lIn0.eyJzdWIiOiJ4In0.' })).status).toBe(401) // gitleaks:allow (bewust ongeldig token)
    })

    it('je kunt je eigen rol niet wijzigen (mass assignment)', async () => {
      const user = await register('Eva')
      const res = await api('PATCH', '/me', { token: user.accessToken, body: { role: 'beheerder' } })
      expect(res.status).toBe(400)
    })

    it('instellingen wijzigen', async () => {
      const user = await register('Fleur')
      const res = await api('PATCH', '/me', { token: user.accessToken, body: { theme: 'donker', locale: 'en' } })
      expect(res.status).toBe(200)
      expect(res.body).toMatchObject({ theme: 'donker', locale: 'en' })
    })

    it('account verwijderen geeft het ticket vrij', async () => {
      const user = await register('Gijs')
      expect((await api('DELETE', '/me', { token: user.accessToken })).status).toBe(204)
      const again = await api('POST', '/auth/register', {
        body: { ticketCode: user.ticketCode, email: 'gijs2@test.nl', password: 'een-heel-sterk-wachtwoord', displayName: 'Gijs' },
      })
      expect(again.status).toBe(201)
    })
  })

  describe('vrienden en locatie', () => {
    it('vriendcode werkt één keer en niet voor jezelf', async () => {
      const a = await register('Hanna')
      const b = await register('Ivo')
      const c = await register('Jan')
      const code = await api('POST', '/friend-codes', { token: a.accessToken })
      expect(code.body.code).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/)
      expect(code.body.qrPayload).toContain(code.body.code)

      expect((await api('POST', '/friends', { token: a.accessToken, body: { code: code.body.code } })).status).toBe(404)
      expect((await api('POST', '/friends', { token: b.accessToken, body: { code: code.body.code.toLowerCase() } })).status).toBe(201)
      expect((await api('POST', '/friends', { token: c.accessToken, body: { code: code.body.code } })).status).toBe(404)

      const friends = await api('GET', '/friends', { token: a.accessToken })
      expect(friends.body.map((f: { displayName: string }) => f.displayName)).toEqual(['Ivo'])
    })

    it('locatie alleen zichtbaar voor vrienden, en alleen als delen aan staat', async () => {
      const a = await register('Kim')
      const friend = await register('Lars')
      const stranger = await register('Mo')
      await befriend(a, friend)

      const denied = await api('PUT', '/me/location', { token: a.accessToken, body: { latitude: 52.38, longitude: 4.87 } })
      expect(denied.status).toBe(403)

      await api('PATCH', '/me', { token: a.accessToken, body: { shareLocation: true } })
      expect((await api('PUT', '/me/location', { token: a.accessToken, body: { latitude: 52.38, longitude: 4.87 } })).status).toBe(204)

      const seen = await api('GET', '/friends/locations', { token: friend.accessToken })
      expect(seen.body).toHaveLength(1)
      expect(seen.body[0]).toMatchObject({ userId: a.id, displayName: 'Kim', latitude: 52.38 })
      expect((await api('GET', '/friends/locations', { token: stranger.accessToken })).body).toEqual([])

      // Delen uitzetten wist de locatie meteen
      await api('PATCH', '/me', { token: a.accessToken, body: { shareLocation: false } })
      expect((await api('GET', '/friends/locations', { token: friend.accessToken })).body).toEqual([])
    })

    it('coördinaten buiten bereik worden geweigerd', async () => {
      const a = await register('Noor')
      await api('PATCH', '/me', { token: a.accessToken, body: { shareLocation: true } })
      expect((await api('PUT', '/me/location', { token: a.accessToken, body: { latitude: 120, longitude: 4 } })).status).toBe(400)
    })

    it('vriend verwijderen stopt alles', async () => {
      const a = await register('Olaf')
      const b = await register('Pien')
      await befriend(a, b)
      expect((await api('DELETE', `/friends/${b.id}`, { token: a.accessToken })).status).toBe(204)
      expect((await api('GET', `/messages/${b.id}`, { token: a.accessToken })).status).toBe(404)
    })
  })

  describe('pins en chat', () => {
    it('pins van vrienden zichtbaar, privé-pins niet', async () => {
      const a = await register('Quinn')
      const b = await register('Rosa')
      await befriend(a, b)
      await api('POST', '/pins', { token: a.accessToken, body: { label: 'Tent', latitude: 52.38, longitude: 4.87 } })
      await api('POST', '/pins', { token: a.accessToken, body: { label: 'Geheim', latitude: 52.38, longitude: 4.87, visibility: 'prive' } })
      const pins = await api('GET', '/pins', { token: b.accessToken })
      expect(pins.body.map((p: { label: string }) => p.label)).toEqual(['Tent'])
      // Andermans pin verwijderen kan niet
      const own = (await api('GET', '/pins', { token: a.accessToken })).body[0]
      expect((await api('DELETE', `/pins/${own.id}`, { token: b.accessToken })).status).toBe(404)
    })

    it('chatten met een vriend, niet met een vreemde', async () => {
      const a = await register('Sam')
      const b = await register('Tess')
      const stranger = await register('Uma')
      await befriend(a, b)
      const sent = await api('POST', `/messages/${b.id}`, { token: a.accessToken, body: { body: '<b>hoi</b>' } })
      expect(sent.status).toBe(201)
      expect(sent.body.body).toBe('<b>hoi</b>') // opgeslagen als platte tekst; de app escapet bij tonen
      const list = await api('GET', `/messages/${a.id}`, { token: b.accessToken })
      expect(list.body).toHaveLength(1)
      expect((await api('POST', `/messages/${a.id}`, { token: stranger.accessToken, body: { body: 'hallo' } })).status).toBe(404)
      expect((await api('POST', `/messages/${b.id}`, { token: a.accessToken, body: { body: 'x'.repeat(1001) } })).status).toBe(400)
    })
  })

  describe('timetable', () => {
    it('programma ophalen en een persoonlijke timetable maken', async () => {
      const a = await register('Vera')
      const stages = await api('GET', '/stages', { token: a.accessToken })
      expect(stages.body).toHaveLength(4)
      const perfs = await api('GET', '/performances', { token: a.accessToken })
      expect(perfs.body.length).toBeGreaterThan(10)
      const id = perfs.body[0].id
      expect((await api('PUT', `/me/timetable/${id}`, { token: a.accessToken })).status).toBe(204)
      expect((await api('GET', '/me/timetable', { token: a.accessToken })).body.map((p: { id: string }) => p.id)).toEqual([id])
    })

    it('timetable van een vriend alleen als die deelt', async () => {
      const a = await register('Wim')
      const b = await register('Xena')
      await befriend(a, b)
      expect((await api('GET', `/friends/${b.id}/timetable`, { token: a.accessToken })).status).toBe(404)
      await api('PATCH', '/me', { token: b.accessToken, body: { shareTimetable: true } })
      expect((await api('GET', `/friends/${b.id}/timetable`, { token: a.accessToken })).status).toBe(200)
    })

    it('aanmelden voor een show: één keer, en niet voor een gewone show', async () => {
      const a = await register('Yara')
      const perfs = (await api('GET', '/performances', { token: a.accessToken })).body as { id: string; signupCapacity: number | null }[]
      const limited = perfs.find((p) => p.signupCapacity)!
      const normal = perfs.find((p) => !p.signupCapacity)!
      expect((await api('POST', `/performances/${limited.id}/signup`, { token: a.accessToken })).status).toBe(201)
      expect((await api('POST', `/performances/${limited.id}/signup`, { token: a.accessToken })).status).toBe(409)
      expect((await api('POST', `/performances/${normal.id}/signup`, { token: a.accessToken })).status).toBe(404)
      expect((await api('GET', '/me/signups', { token: a.accessToken })).body).toHaveLength(1)
    })
  })

  describe('beheerportal en noodberichten', () => {
    it('bezoekers kunnen geen beheerroutes gebruiken', async () => {
      const visitor = await login('anna@festival.test')
      const res = await api('POST', '/admin/announcements', {
        token: visitor.accessToken,
        body: { level: 'nood', titleNl: 'Nep', titleEn: 'Fake', bodyNl: 'Nep', bodyEn: 'Fake' },
      })
      expect(res.status).toBe(403)
      expect((await api('GET', '/admin/sos', { token: visitor.accessToken })).status).toBe(403)
    })

    it('noodbericht komt live binnen via WebSocket', async () => {
      const visitor = await login('anna@festival.test')
      const org = await login('organisatie@festival.test')
      const ws = new WebSocket(`${base.replace('http', 'ws')}/ws?token=${visitor.accessToken}`)
      const received = new Promise<{ type: string; data: { titleNl: string } }>((resolve, reject) => {
        ws.on('message', (raw) => {
          const msg = JSON.parse(raw.toString())
          if (msg.type === 'announcement') resolve(msg)
        })
        ws.on('error', reject)
      })
      await new Promise((resolve) => ws.on('open', resolve))
      // wachten op "hello" zodat de verbinding geregistreerd is
      await new Promise((resolve) => setTimeout(resolve, 50))
      const res = await api('POST', '/admin/announcements', {
        token: org.accessToken,
        body: { level: 'nood', titleNl: 'Onweer', titleEn: 'Storm', bodyNl: 'Zoek beschutting.', bodyEn: 'Seek shelter.' },
      })
      expect(res.status).toBe(201)
      expect((await received).data.titleNl).toBe('Onweer')
      ws.close()
      expect((await api('GET', '/announcements', { token: visitor.accessToken })).body[0].titleNl).toBe('Onweer')
    })

    it('WebSocket zonder geldig token wordt geweigerd', async () => {
      const ws = new WebSocket(`${base.replace('http', 'ws')}/ws?token=onzin`)
      const code = await new Promise((resolve) => ws.on('unexpected-response', (_req, res) => resolve(res.statusCode)))
      expect(code).toBe(401)
    })

    it('SOS komt bij de organisatie en kan worden afgehandeld', async () => {
      const visitor = await login('bram@festival.test')
      const org = await login('organisatie@festival.test')
      const sos = await api('POST', '/sos', { token: visitor.accessToken, body: { latitude: 52.387, longitude: 4.876, message: 'Hulp' } })
      expect(sos.status).toBe(201)
      const open = await api('GET', '/admin/sos', { token: org.accessToken })
      expect(open.body.some((s: { id: string }) => s.id === sos.body.id)).toBe(true)
      const done = await api('PATCH', `/admin/sos/${sos.body.id}`, { token: org.accessToken, body: { status: 'afgehandeld' } })
      expect(done.body.status).toBe('afgehandeld')
      expect(done.body.resolvedAt).not.toBeNull()
    })

    it('optreden wijzigen werkt; ongeldige tijden niet', async () => {
      const org = await login('organisatie@festival.test')
      const perf = (await api('GET', '/performances', { token: org.accessToken })).body[0]
      const delayed = await api('PATCH', `/admin/performances/${perf.id}`, { token: org.accessToken, body: { status: 'vertraagd' } })
      expect(delayed.body.status).toBe('vertraagd')
      const bad = await api('PATCH', `/admin/performances/${perf.id}`, { token: org.accessToken, body: { endsAt: '2000-01-01T00:00:00Z' } })
      expect(bad.status).toBe(400)
    })

    it('alleen een beheerder mag tickets importeren', async () => {
      const org = await login('organisatie@festival.test')
      const admin = await login('beheerder@festival.test')
      const body = { tickets: [{ code: 'IMPORT-0001', validFrom: '2026-01-01T00:00:00Z', validUntil: '2030-01-01T00:00:00Z' }] }
      expect((await api('POST', '/admin/tickets/import', { token: org.accessToken, body })).status).toBe(403)
      const res = await api('POST', '/admin/tickets/import', { token: admin.accessToken, body })
      expect(res.body).toEqual({ imported: 1, skipped: 0 })
    })
  })

  describe('gebruikers beheren', () => {
    it('beheerder zoekt een bezoeker en maakt het ticket VIP', async () => {
      const admin = await login('beheerder@festival.test')
      const visitor = await register('Vipje')
      const found = await api('GET', '/admin/users?q=vipje', { token: admin.accessToken })
      expect(found.status).toBe(200)
      expect(found.body.map((u: { id: string }) => u.id)).toEqual([visitor.id])
      const updated = await api('PATCH', `/admin/users/${visitor.id}`, { token: admin.accessToken, body: { ticketType: 'vip' } })
      expect(updated.status).toBe(200)
      expect(updated.body).toMatchObject({ ticketType: 'vip', blocked: false })
    })

    it('blokkeren logt uit en houdt inloggen tegen; deblokkeren maakt het weer mogelijk', async () => {
      const admin = await login('beheerder@festival.test')
      const visitor = await register('Lastpak')
      const noReason = await api('PATCH', `/admin/users/${visitor.id}`, { token: admin.accessToken, body: { blocked: true } })
      expect(noReason.status).toBe(400)
      const blocked = await api('PATCH', `/admin/users/${visitor.id}`, { token: admin.accessToken, body: { blocked: true, blockedReason: 'Incident op het terrein' } })
      expect(blocked.body).toMatchObject({ blocked: true, blockedReason: 'Incident op het terrein' })

      expect((await api('POST', '/auth/refresh', { body: { refreshToken: visitor.refreshToken } })).status).toBe(401)
      const again = await api('POST', '/auth/login', { body: { email: 'lastpak@test.nl', password: 'een-heel-sterk-wachtwoord' } })
      expect(again.status).toBe(403)

      await api('PATCH', `/admin/users/${visitor.id}`, { token: admin.accessToken, body: { blocked: false } })
      await login('lastpak@test.nl', 'een-heel-sterk-wachtwoord')
    })

    it('alleen een beheerder, en alleen bezoekers', async () => {
      const org = await login('organisatie@festival.test')
      expect((await api('GET', '/admin/users', { token: org.accessToken })).status).toBe(403)
      const admin = await login('beheerder@festival.test')
      const staff = await api('GET', '/admin/users?q=organisatie@', { token: admin.accessToken })
      const res = await api('PATCH', `/admin/users/${staff.body[0].id}`, { token: admin.accessToken, body: { blocked: true, blockedReason: 'Test' } })
      expect(res.status).toBe(403)
    })
  })

  describe('kaartpunten', () => {
    it('organisatie zet een punt op de kaart en bezoekers zien het', async () => {
      const org = await login('organisatie@festival.test')
      const visitor = await login('anna@festival.test')
      const created = await api('POST', '/admin/map-points', {
        token: org.accessToken,
        body: { kind: 'wifi', name: 'Wifi bij de ingang', latitude: 52.373, longitude: 4.892 },
      })
      expect(created.status).toBe(201)
      expect(created.body).toMatchObject({ kind: 'wifi', name: 'Wifi bij de ingang', description: null })

      const list = await api('GET', '/map-points', { token: visitor.accessToken })
      expect(list.status).toBe(200)
      expect(list.body.map((p: { id: string }) => p.id)).toContain(created.body.id)

      const updated = await api('PATCH', `/admin/map-points/${created.body.id}`, {
        token: org.accessToken,
        body: { description: 'Netwerk "Festival"' },
      })
      expect(updated.status).toBe(200)
      expect(updated.body.description).toBe('Netwerk "Festival"')

      expect((await api('DELETE', `/admin/map-points/${created.body.id}`, { token: org.accessToken })).status).toBe(204)
      expect((await api('DELETE', `/admin/map-points/${created.body.id}`, { token: org.accessToken })).status).toBe(404)
    })

    it('bezoekers kunnen geen kaartpunten aanpassen', async () => {
      const visitor = await login('anna@festival.test')
      const res = await api('POST', '/admin/map-points', {
        token: visitor.accessToken,
        body: { kind: 'ehbo', name: 'Nep', latitude: 52.37, longitude: 4.89 },
      })
      expect(res.status).toBe(403)
    })

    it('weigert een onbekende soort of een punt buiten de wereld', async () => {
      const org = await login('organisatie@festival.test')
      const kind = await api('POST', '/admin/map-points', { token: org.accessToken, body: { kind: 'kroeg', name: 'Bar', latitude: 52.37, longitude: 4.89 } })
      expect(kind.status).toBe(400)
      const lat = await api('POST', '/admin/map-points', { token: org.accessToken, body: { kind: 'ehbo', name: 'EHBO', latitude: 95, longitude: 4.89 } })
      expect(lat.status).toBe(400)
    })
  })

  describe('drukte en chatbot', () => {
    it('IoT-meting met sleutel, zonder sleutel 401', async () => {
      const visitor = await login('anna@festival.test')
      const stage = (await api('GET', '/stages', { token: visitor.accessToken })).body[0]
      const body = { stageId: stage.id, headCount: 12000 }
      expect((await api('POST', '/iot/crowd-readings', { body })).status).toBe(401)
      expect((await api('POST', '/iot/crowd-readings', { body, headers: { 'X-Device-Key': IOT_KEY } })).status).toBe(202)
      const crowd = await api('GET', '/crowd', { token: visitor.accessToken })
      expect(crowd.body.find((c: { stageId: string }) => c.stageId === stage.id)).toMatchObject({ level: 'druk' })
    })

    it('chatbot beantwoordt een vraag over de timetable', async () => {
      const visitor = await login('anna@festival.test')
      const res = await api('POST', '/chatbot', { token: visitor.accessToken, body: { question: 'Wanneer speelt Nova Lights?' } })
      expect(res.status).toBe(200)
      expect(res.body.answer).toContain('Hoofdpodium')
    })
  })

  describe('rate limiting', () => {
    it('te veel inlogpogingen geeft 429 met Retry-After', async () => {
      let last: Res | undefined
      for (let i = 0; i < 12; i++) {
        last = await api('POST', '/auth/login', {
          body: { email: 'brute@test.nl', password: 'probeer-' + i },
          headers: { 'X-Forwarded-For': '203.0.113.7' },
        })
      }
      expect(last?.status).toBe(429)
      expect(Number(last?.headers.get('retry-after'))).toBeGreaterThan(0)
    })
  })
})
