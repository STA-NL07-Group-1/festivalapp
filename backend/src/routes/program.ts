// Podia, timetable, persoonlijke timetable, aanmelden voor shows en drukte.
import type { Deps } from '../app.ts'
import { areFriends, transaction } from '../db.ts'
import { HttpError, UUID_RE, badRequest, conflict, notFound, requireFestival, requireUser, uuidParam, type Router } from '../http.ts'
import { PERFORMANCE_COLUMNS, toCrowd, toPerformance, toSignup, toStage } from './mappers.ts'

export function crowdLevel(headCount: number, capacity: number): 'rustig' | 'gemiddeld' | 'druk' | 'vol' {
  const ratio = capacity > 0 ? headCount / capacity : 1
  if (ratio < 0.4) return 'rustig'
  if (ratio < 0.7) return 'gemiddeld'
  if (ratio < 0.9) return 'druk'
  return 'vol'
}

export function programRoutes(r: Router, deps: Deps): void {
  const { db, config } = deps
  const perfColumns = PERFORMANCE_COLUMNS.split(', ').map((c) => `p.${c}`).join(', ')
  // Een optreden hoort via zijn podium bij een festival
  const IN_FESTIVAL = 'SELECT 1 FROM performances p JOIN stages s ON s.id = p.stage_id WHERE p.id = $1 AND s.festival_id = $2'

  r.get('/stages', { operationId: 'listStages' }, async (ctx) => {
    const { rows } = await db.query('SELECT * FROM stages WHERE festival_id = $1 ORDER BY sort_order, name LIMIT 100', [requireFestival(ctx)])
    return { status: 200, body: rows.map(toStage) }
  })

  r.get('/performances', { operationId: 'listPerformances' }, async (ctx) => {
    const stageId = ctx.query.get('stageId')
    const day = ctx.query.get('day')
    if (stageId && !UUID_RE.test(stageId)) throw badRequest('Het veld "stageId" is ongeldig.')
    if (day && !/^\d{4}-\d{2}-\d{2}$/.test(day)) throw badRequest('Het veld "day" is ongeldig.')
    const { rows } = await db.query(
      `SELECT ${perfColumns} FROM performances p JOIN stages s ON s.id = p.stage_id
        WHERE s.festival_id = $4
          AND ($1::uuid IS NULL OR p.stage_id = $1)
          AND ($2::date IS NULL OR (p.starts_at AT TIME ZONE $3)::date = $2)
        ORDER BY p.starts_at
        LIMIT 1000`,
      [stageId, day, config.festivalTimeZone, requireFestival(ctx)],
    )
    return { status: 200, body: rows.map(toPerformance) }
  })

  r.get('/me/timetable', { operationId: 'getMyTimetable' }, async (ctx) => {
    const user = requireUser(ctx)
    const { rows } = await db.query(
      `SELECT ${perfColumns} FROM timetable_entries t
         JOIN performances p ON p.id = t.performance_id JOIN stages s ON s.id = p.stage_id
        WHERE t.user_id = $1 AND s.festival_id = $2 ORDER BY p.starts_at LIMIT 500`,
      [user.id, requireFestival(ctx)],
    )
    return { status: 200, body: rows.map(toPerformance) }
  })

  r.put('/me/timetable/:performanceId', { operationId: 'addToMyTimetable' }, async (ctx) => {
    const user = requireUser(ctx)
    const id = uuidParam(ctx, 'performanceId')
    const { rowCount } = await db.query(IN_FESTIVAL, [id, requireFestival(ctx)])
    if (!rowCount) throw notFound()
    await db.query('INSERT INTO timetable_entries (user_id, performance_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [user.id, id])
    return { status: 204 }
  })

  r.delete('/me/timetable/:performanceId', { operationId: 'removeFromMyTimetable' }, async (ctx) => {
    const user = requireUser(ctx)
    await db.query('DELETE FROM timetable_entries WHERE user_id = $1 AND performance_id = $2', [
      user.id,
      uuidParam(ctx, 'performanceId'),
    ])
    return { status: 204 }
  })

  r.get('/friends/:userId/timetable', { operationId: 'getFriendTimetable' }, async (ctx) => {
    const user = requireUser(ctx)
    const friend = uuidParam(ctx, 'userId')
    const festivalId = requireFestival(ctx)
    const shared = await db.query('SELECT 1 FROM users WHERE id = $1 AND share_timetable', [friend])
    // Geen vriend of deelt niet: zelfde 404, zodat je niet kunt aftasten wie er bestaat
    if (!shared.rowCount || !(await areFriends(db, user.id, friend))) throw notFound()
    const { rows } = await db.query(
      `SELECT ${perfColumns} FROM timetable_entries t
         JOIN performances p ON p.id = t.performance_id JOIN stages s ON s.id = p.stage_id
        WHERE t.user_id = $1 AND s.festival_id = $2 ORDER BY p.starts_at LIMIT 500`,
      [friend, festivalId],
    )
    return { status: 200, body: rows.map(toPerformance) }
  })

  r.get('/me/signups', { operationId: 'listMySignups' }, async (ctx) => {
    const user = requireUser(ctx)
    const { rows } = await db.query(
      `SELECT g.* FROM show_signups g
         JOIN performances p ON p.id = g.performance_id JOIN stages s ON s.id = p.stage_id
        WHERE g.user_id = $1 AND s.festival_id = $2 ORDER BY g.created_at LIMIT 500`,
      [user.id, requireFestival(ctx)],
    )
    return { status: 200, body: rows.map(toSignup) }
  })

  r.post('/performances/:performanceId/signup', { operationId: 'signUpForShow', rateLimit: { limit: 20, windowMs: 60_000 } }, async (ctx) => {
    const user = requireUser(ctx)
    const id = uuidParam(ctx, 'performanceId')
    if (!(await db.query(IN_FESTIVAL, [id, requireFestival(ctx)])).rowCount) throw notFound()
    const signup = await transaction(db, async (tx) => {
      // Rij vergrendelen zodat twee mensen niet tegelijk de laatste plek krijgen
      const perf = await tx.query<{ signup_capacity: number | null; status: string }>(
        'SELECT signup_capacity, status FROM performances WHERE id = $1 FOR UPDATE',
        [id],
      )
      const p = perf.rows[0]
      if (!p || p.signup_capacity === null || p.status === 'geannuleerd') throw notFound()
      const count = await tx.query<{ n: number }>('SELECT count(*)::int AS n FROM show_signups WHERE performance_id = $1', [id])
      if ((count.rows[0]?.n ?? 0) >= p.signup_capacity) throw conflict('Deze show is vol.')
      const inserted = await tx.query(
        'INSERT INTO show_signups (user_id, performance_id) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING *',
        [user.id, id],
      )
      if (!inserted.rows[0]) throw conflict('Je bent al aangemeld.')
      return inserted.rows[0]
    })
    return { status: 201, body: toSignup(signup) }
  })

  r.delete('/performances/:performanceId/signup', { operationId: 'cancelSignup' }, async (ctx) => {
    const user = requireUser(ctx)
    await db.query('DELETE FROM show_signups WHERE user_id = $1 AND performance_id = $2', [user.id, uuidParam(ctx, 'performanceId')])
    return { status: 204 }
  })

  r.get('/crowd', { operationId: 'getCrowdLevels' }, async (ctx) => {
    const { rows } = await db.query(
      `SELECT DISTINCT ON (c.stage_id) c.stage_id, c.level, c.head_count, c.measured_at
         FROM crowd_readings c JOIN stages s ON s.id = c.stage_id
        WHERE s.festival_id = $1 AND c.measured_at > now() - interval '15 minutes'
        ORDER BY c.stage_id, c.measured_at DESC
        LIMIT 100`,
      [requireFestival(ctx)],
    )
    return { status: 200, body: rows.map(toCrowd) }
  })

  // ------------------------------------------------------------- IoT
  r.post('/iot/crowd-readings', { operationId: 'postCrowdReading', auth: 'iot', rateLimit: { limit: 60, windowMs: 60_000 } }, async (ctx) => {
    const body = ctx.body as { stageId: string; headCount: number; measuredAt?: string }
    const stage = await db.query<{ capacity: number; festival_id: string }>('SELECT capacity, festival_id FROM stages WHERE id = $1', [body.stageId])
    if (!stage.rows[0]) throw badRequest('Onbekend podium.')
    const measuredAt = body.measuredAt ? new Date(body.measuredAt) : new Date()
    // Metingen uit de toekomst of van lang geleden negeren we
    if (Math.abs(Date.now() - measuredAt.getTime()) > 10 * 60_000) throw new HttpError(400, 'validation_failed', 'Tijdstip te ver van nu.')
    const level = crowdLevel(body.headCount, stage.rows[0].capacity)
    const { rows } = await db.query(
      `INSERT INTO crowd_readings (stage_id, device_id, head_count, level, measured_at)
       VALUES ($1, $2, $3, $4, $5) RETURNING stage_id, level, head_count, measured_at`,
      [body.stageId, ctx.deviceId, body.headCount, level, measuredAt],
    )
    deps.realtime.toFestival(stage.rows[0].festival_id, 'crowd.update', toCrowd(rows[0]!))
    return { status: 202 }
  })
}
