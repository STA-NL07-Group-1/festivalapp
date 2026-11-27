// NFC-polsbanden (issue #79): koppelen in de app, saldo, betalen bij de bar, opwaarderen,
// poortjes bij de ingang en check-ins bij een podium (drukte).
// De terminals sturen het nummer (UID) van de polsband; wij bewaren alleen de SHA-256 daarvan.
import type { Deps } from '../app.ts'
import { audit, transaction, type Queryable } from '../db.ts'
import { HttpError, badRequest, conflict, forbidden, notFound, requireFestival, requireUser, UUID_RE, type Router } from '../http.ts'
import { sha256 } from '../security.ts'
import { toCrowd } from './mappers.ts'
import { crowdLevel } from './program.ts'

/** Hash van een UID: altijd hoofdletters, zodat "04a1" en "04A1" dezelfde polsband zijn */
export const tagHash = (tag: string) => sha256(tag.trim().toUpperCase())

/** Hoogste bedrag dat een terminal zonder verbinding mag goedkeuren (in centen) */
export const OFFLINE_LIMIT_CENTS = 1000
/** Hoe lang een check-in bij een podium meetelt voor de drukte */
const CHECKIN_WINDOW = '30 minutes'

interface Wristband {
  id: string
  user_id: string | null
  blocked_at: Date | null
}

type Row = Record<string, unknown>
const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : String(v))
const toTransaction = (r: Row) => ({
  id: r.id,
  kind: r.kind,
  amountCents: r.amount_cents,
  balanceAfter: r.balance_after,
  offline: r.offline,
  occurredAt: iso(r.occurred_at),
})

async function findWristband(db: Queryable, festivalId: string, tag: string): Promise<Wristband | null> {
  const { rows } = await db.query<Wristband>('SELECT id, user_id, blocked_at FROM wristbands WHERE festival_id = $1 AND uid_hash = $2', [
    festivalId,
    tagHash(tag),
  ])
  return rows[0] ?? null
}

/** Een polsband die bij een terminal mag werken: bekend, gekoppeld en niet geblokkeerd */
async function usableWristband(db: Queryable, festivalId: string, tag: string): Promise<Wristband & { user_id: string }> {
  const band = await findWristband(db, festivalId, tag)
  if (!band?.user_id) throw notFound('Onbekende polsband.')
  if (band.blocked_at) throw forbidden('Deze polsband is geblokkeerd.')
  return band as Wristband & { user_id: string }
}

async function loadWallet(db: Queryable, festivalId: string, userId: string) {
  const [wallet, band, transactions] = await Promise.all([
    db.query<{ balance_cents: number }>('SELECT balance_cents FROM wallets WHERE festival_id = $1 AND user_id = $2', [festivalId, userId]),
    db.query<{ linked_at: Date; blocked_at: Date | null }>(
      `SELECT linked_at, blocked_at FROM wristbands WHERE festival_id = $1 AND user_id = $2
        ORDER BY (blocked_at IS NULL) DESC, linked_at DESC LIMIT 1`,
      [festivalId, userId],
    ),
    db.query(
      `SELECT id, kind, amount_cents, balance_after, offline, occurred_at FROM wallet_transactions
        WHERE festival_id = $1 AND user_id = $2 ORDER BY occurred_at DESC, created_at DESC LIMIT 20`,
      [festivalId, userId],
    ),
  ])
  const b = band.rows[0]
  return {
    balanceCents: wallet.rows[0]?.balance_cents ?? 0,
    wristband: b ? { linkedAt: iso(b.linked_at), blocked: b.blocked_at !== null } : null,
    transactions: transactions.rows.map(toTransaction),
  }
}

export function walletRoutes(r: Router, deps: Deps): void {
  const { db } = deps

  // ------------------------------------------------------------- app
  r.get('/me/wallet', { operationId: 'getWallet' }, async (ctx) => {
    const user = requireUser(ctx)
    return { status: 200, body: await loadWallet(db, requireFestival(ctx), user.id) }
  })

  r.post('/me/wristband', { operationId: 'linkWristband', rateLimit: { limit: 5, windowMs: 60_000 } }, async (ctx) => {
    const user = requireUser(ctx)
    const festivalId = requireFestival(ctx)
    const { tag } = ctx.body as { tag: string }
    await transaction(db, async (tx) => {
      const band = await findWristband(tx, festivalId, tag)
      if (band?.user_id && band.user_id !== user.id) throw conflict('Deze polsband is al van iemand anders.')
      if (band?.blocked_at) throw forbidden('Deze polsband is geblokkeerd.')
      if (band?.user_id === user.id) return // al gekoppeld
      // Een oude polsband van dit account werkt niet meer (kwijt of kapot); het saldo blijft
      await tx.query('UPDATE wristbands SET blocked_at = now() WHERE festival_id = $1 AND user_id = $2 AND blocked_at IS NULL', [
        festivalId,
        user.id,
      ])
      if (band) {
        await tx.query('UPDATE wristbands SET user_id = $2, linked_at = now() WHERE id = $1', [band.id, user.id])
      } else {
        await tx.query('INSERT INTO wristbands (festival_id, uid_hash, user_id, linked_at) VALUES ($1, $2, $3, now())', [
          festivalId,
          tagHash(tag),
          user.id,
        ])
      }
      await tx.query('INSERT INTO wallets (festival_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [festivalId, user.id])
      await audit(tx, user.id, 'wristband.link', { type: 'festival', id: festivalId })
    })
    return { status: 200, body: await loadWallet(db, festivalId, user.id) }
  })

  r.post('/me/wristband/block', { operationId: 'blockWristband' }, async (ctx) => {
    const user = requireUser(ctx)
    const festivalId = requireFestival(ctx)
    const { rowCount } = await db.query(
      'UPDATE wristbands SET blocked_at = now() WHERE festival_id = $1 AND user_id = $2 AND blocked_at IS NULL',
      [festivalId, user.id],
    )
    if (!rowCount) throw notFound('Je hebt geen actieve polsband.')
    await audit(db, user.id, 'wristband.block', { type: 'festival', id: festivalId })
    return { status: 204 }
  })

  // ------------------------------------------------------------- IoT: saldo
  /** Betaling (negatief) of opwaardering (positief) in één transactie; dezelfde id telt maar één keer */
  async function book(
    deviceId: string,
    input: { id: string; festivalId: string; tag: string; amountCents: number; occurredAt?: string; offline?: boolean },
    kind: 'betaling' | 'opwaardering',
  ) {
    const offline = kind === 'betaling' && input.offline === true
    if (offline && input.amountCents > OFFLINE_LIMIT_CENTS) throw badRequest('Offline mag maximaal €10 per betaling.')
    const occurredAt = input.occurredAt ? new Date(input.occurredAt) : new Date()
    // Een offline betaling mag van eerder vandaag zijn, maar niet uit de toekomst
    const maxAge = offline ? 24 * 60 * 60_000 : 10 * 60_000
    if (occurredAt.getTime() > Date.now() + 60_000 || Date.now() - occurredAt.getTime() > maxAge) {
      throw badRequest('Tijdstip te ver van nu.')
    }

    const run = () => transaction(db, async (tx) => {
      const earlier = await tx.query<{ kind: string; amount_cents: number; balance_after: number; festival_id: string; wristband_uid: string | null }>(
        `SELECT t.kind, t.amount_cents, t.balance_after, t.festival_id, w.uid_hash AS wristband_uid
           FROM wallet_transactions t LEFT JOIN wristbands w ON w.id = t.wristband_id WHERE t.id = $1`,
        [input.id],
      )
      const prev = earlier.rows[0]
      if (prev) {
        // Dezelfde betaling nog een keer: hetzelfde antwoord, niet opnieuw afschrijven
        const same = prev.kind === kind && prev.amount_cents === input.amountCents && prev.festival_id === input.festivalId && prev.wristband_uid === tagHash(input.tag)
        if (!same) throw conflict('Deze id is al gebruikt voor een andere betaling.')
        return { transactionId: input.id, balanceCents: prev.balance_after, userId: null }
      }

      const band = await usableWristband(tx, input.festivalId, input.tag)
      // ON CONFLICT DO UPDATE zet de rij vast tot het einde van de transactie: twee terminals tegelijk
      // schrijven zo nooit allebei van hetzelfde saldo af
      const wallet = await tx.query<{ balance_cents: number }>(
        `INSERT INTO wallets (festival_id, user_id) VALUES ($1, $2)
           ON CONFLICT (festival_id, user_id) DO UPDATE SET updated_at = now()
           RETURNING balance_cents`,
        [input.festivalId, band.user_id],
      )
      const current = wallet.rows[0]!.balance_cents
      const delta = kind === 'betaling' ? -input.amountCents : input.amountCents
      if (kind === 'betaling' && !offline && current + delta < 0) {
        throw new HttpError(402, 'insufficient_balance', 'Saldo te laag.')
      }
      const balance = current + delta
      await tx.query('UPDATE wallets SET balance_cents = $3, updated_at = now() WHERE festival_id = $1 AND user_id = $2', [
        input.festivalId,
        band.user_id,
        balance,
      ])
      await tx.query(
        `INSERT INTO wallet_transactions (id, festival_id, user_id, wristband_id, kind, amount_cents, balance_after, device_id, offline, occurred_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [input.id, input.festivalId, band.user_id, band.id, kind, input.amountCents, balance, deviceId, offline, occurredAt],
      )
      return { transactionId: input.id, balanceCents: balance, userId: band.user_id as string | null }
    })
    let result: Awaited<ReturnType<typeof run>>
    try {
      result = await run()
    } catch (error) {
      // Dezelfde betaling kwam twee keer tegelijk binnen: de tweede ziet nu de eerste en geeft hetzelfde antwoord
      if ((error as { code?: string; constraint?: string }).constraint !== 'wallet_transactions_pkey') throw error
      result = await run()
    }

    if (result.userId) {
      deps.realtime.toUsers([result.userId], 'wallet.update', { balanceCents: result.balanceCents }, input.festivalId)
    }
    return { transactionId: result.transactionId, balanceCents: result.balanceCents }
  }

  r.post('/iot/payments', { operationId: 'postPayment', auth: 'iot', rateLimit: { limit: 120, windowMs: 60_000 } }, async (ctx) => {
    const body = ctx.body as Parameters<typeof book>[1]
    return { status: 200, body: await book(ctx.deviceId!, body, 'betaling') }
  })

  r.post('/iot/topups', { operationId: 'postTopup', auth: 'iot', rateLimit: { limit: 60, windowMs: 60_000 } }, async (ctx) => {
    const body = ctx.body as Parameters<typeof book>[1]
    return { status: 200, body: await book(ctx.deviceId!, body, 'opwaardering') }
  })

  r.get('/iot/blocked-tags', { operationId: 'getBlockedTags', auth: 'iot', rateLimit: { limit: 10, windowMs: 60_000 } }, async (ctx) => {
    const festivalId = ctx.query.get('festivalId') ?? ''
    if (!UUID_RE.test(festivalId)) throw badRequest('Geef een geldig festivalId mee.')
    const { rows } = await db.query<{ uid_hash: string }>(
      'SELECT uid_hash FROM wristbands WHERE festival_id = $1 AND blocked_at IS NOT NULL ORDER BY uid_hash LIMIT 100000',
      [festivalId],
    )
    return { status: 200, body: { tagHashes: rows.map((r) => r.uid_hash) } }
  })

  // ------------------------------------------------------------- IoT: drukte
  r.post('/iot/checkins', { operationId: 'postCheckin', auth: 'iot', rateLimit: { limit: 120, windowMs: 60_000 } }, async (ctx) => {
    const body = ctx.body as { stageId: string; tag: string }
    const stage = await db.query<{ capacity: number; festival_id: string }>('SELECT capacity, festival_id FROM stages WHERE id = $1', [body.stageId])
    if (!stage.rows[0]) throw badRequest('Onbekend podium.')
    const { capacity, festival_id: festivalId } = stage.rows[0]
    const band = await usableWristband(db, festivalId, body.tag)
    await db.query('INSERT INTO stage_checkins (stage_id, wristband_id, device_id) VALUES ($1, $2, $3)', [body.stageId, band.id, ctx.deviceId])
    // Telt alleen polsbanden die het laatst bij dít podium tikten: wie doorloopt naar een ander podium telt daar
    const { rows: count } = await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM (
         SELECT DISTINCT ON (c.wristband_id) c.stage_id
           FROM stage_checkins c JOIN stages s ON s.id = c.stage_id
          WHERE s.festival_id = $1 AND c.checked_in_at > now() - $3::interval
          ORDER BY c.wristband_id, c.checked_in_at DESC
       ) latest WHERE latest.stage_id = $2`,
      [festivalId, body.stageId, CHECKIN_WINDOW],
    )
    const headCount = count[0]?.n ?? 0
    const { rows } = await db.query(
      `INSERT INTO crowd_readings (stage_id, device_id, head_count, level)
       VALUES ($1, $2, $3, $4) RETURNING stage_id, level, head_count, measured_at`,
      [body.stageId, ctx.deviceId, headCount, crowdLevel(headCount, capacity)],
    )
    const crowd = toCrowd(rows[0]!)
    deps.realtime.toFestival(festivalId, 'crowd.update', crowd)
    return { status: 200, body: crowd }
  })

  // ------------------------------------------------------------- IoT: poortjes
  r.post('/iot/gate-scans', { operationId: 'postGateScan', auth: 'iot', rateLimit: { limit: 300, windowMs: 60_000 } }, async (ctx) => {
    const body = ctx.body as { festivalId: string; tag: string; direction: 'in' | 'uit' }
    const band = await findWristband(db, body.festivalId, body.tag)
    let reason: string | null = null
    if (!band?.user_id) reason = 'onbekende_polsband'
    else if (band.blocked_at) reason = 'polsband_geblokkeerd'
    else if (body.direction === 'in') {
      const { rows } = await db.query<{ blocked: boolean; allowed: boolean }>(
        `SELECT (u.blocked_at IS NOT NULL OR EXISTS (SELECT 1 FROM festival_blocks b WHERE b.festival_id = $1 AND b.user_id = u.id)) AS blocked,
                (EXISTS (SELECT 1 FROM tickets t WHERE t.festival_id = $1 AND t.user_id = u.id AND t.status = 'gekoppeld'
                           AND now() >= t.valid_from AND now() < t.valid_until)
                 OR EXISTS (SELECT 1 FROM festival_members m WHERE m.festival_id = $1 AND m.user_id = u.id)) AS allowed
           FROM users u WHERE u.id = $2`,
        [body.festivalId, band.user_id],
      )
      const user = rows[0]
      if (!user || user.blocked) reason = 'geblokkeerd'
      else if (!user.allowed) reason = 'geen_ticket'
    }
    // Ook als de polsband onbekend is slaan we de scan op (zonder polsband), maar alleen bij een bestaand festival
    const festival = await db.query('SELECT 1 FROM festivals WHERE id = $1', [body.festivalId])
    if (festival.rowCount) {
      await db.query(
        'INSERT INTO gate_scans (festival_id, wristband_id, user_id, device_id, direction, allowed, reason) VALUES ($1, $2, $3, $4, $5, $6, $7)',
        [body.festivalId, band?.id ?? null, band?.user_id ?? null, ctx.deviceId, body.direction, reason === null, reason],
      )
    }
    return { status: 200, body: reason === null ? { allowed: true } : { allowed: false, reason } }
  })
}
