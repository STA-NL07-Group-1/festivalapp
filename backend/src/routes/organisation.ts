// Pushmeldingen, mededelingen, SOS, beheerportal en systeem.
import type { Deps } from '../app.ts'
import { audit } from '../db.ts'
import { badRequest, notFound, requireUser, uuidParam, type Router } from '../http.ts'
import { sha256 } from '../security.ts'
import { PERFORMANCE_COLUMNS, toAnnouncement, toPerformance, toSos } from './mappers.ts'

const STAFF = ['organisatie', 'beheerder'] as const

export function organisationRoutes(r: Router, deps: Deps): void {
  const { db } = deps

  r.get('/health', { operationId: 'getHealth', auth: 'none' }, async () => {
    await db.query('SELECT 1')
    return { status: 200, body: { status: 'ok' } }
  })

  // ------------------------------------------------------------- push
  r.get('/push-subscriptions/public-key', { operationId: 'getPushPublicKey' }, () => ({
    status: 200,
    body: { publicKey: deps.push.publicKey },
  }))

  r.post('/push-subscriptions', { operationId: 'subscribePush', rateLimit: { limit: 10, windowMs: 60_000 } }, async (ctx) => {
    const user = requireUser(ctx)
    const { endpoint, keys } = ctx.body as { endpoint: string; keys: { p256dh: string; auth: string } }
    await db.query(
      `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth) VALUES ($1, $2, $3, $4)
       ON CONFLICT (endpoint) DO UPDATE SET user_id = EXCLUDED.user_id, p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth`,
      [user.id, endpoint, keys.p256dh, keys.auth],
    )
    return { status: 201 }
  })

  r.delete('/push-subscriptions', { operationId: 'unsubscribePush' }, async (ctx) => {
    const user = requireUser(ctx)
    const { endpoint } = ctx.body as { endpoint: string }
    await db.query('DELETE FROM push_subscriptions WHERE user_id = $1 AND endpoint = $2', [user.id, endpoint])
    return { status: 204 }
  })

  // ------------------------------------------------------------- mededelingen
  r.get('/announcements', { operationId: 'listAnnouncements' }, async () => {
    const { rows } = await db.query(
      `SELECT * FROM announcements WHERE expires_at IS NULL OR expires_at > now()
        ORDER BY created_at DESC LIMIT 200`,
    )
    return { status: 200, body: rows.map(toAnnouncement) }
  })

  r.post('/admin/announcements', { operationId: 'createAnnouncement', roles: [...STAFF] }, async (ctx) => {
    const user = requireUser(ctx)
    const b = ctx.body as { level: string; titleNl: string; titleEn: string; bodyNl: string; bodyEn: string; expiresAt?: string }
    if (b.expiresAt && new Date(b.expiresAt) <= new Date()) throw badRequest('De verloopdatum ligt in het verleden.')
    const { rows } = await db.query(
      `INSERT INTO announcements (author_id, level, title_nl, title_en, body_nl, body_en, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [user.id, b.level, b.titleNl.trim(), b.titleEn.trim(), b.bodyNl.trim(), b.bodyEn.trim(), b.expiresAt ?? null],
    )
    const announcement = toAnnouncement(rows[0]!)
    await audit(db, user.id, 'announcement.create', { type: 'announcement', id: String(announcement.id) }, { level: b.level })
    deps.realtime.toAll('announcement', announcement)
    if (b.level !== 'info') {
      void deps.push.toEveryone({
        title: b.level === 'nood' ? `⚠️ ${b.titleNl}` : b.titleNl,
        body: b.bodyNl,
        tag: `announcement-${announcement.id}`,
        url: '/?tab=meldingen',
        urgent: b.level === 'nood',
      })
    }
    return { status: 201, body: announcement }
  })

  // ------------------------------------------------------------- SOS
  r.post('/sos', { operationId: 'sendSos', rateLimit: { limit: 3, windowMs: 60_000 } }, async (ctx) => {
    const user = requireUser(ctx)
    const b = ctx.body as { latitude?: number; longitude?: number; message?: string }
    const { rows } = await db.query(
      'INSERT INTO sos_alerts (user_id, latitude, longitude, message) VALUES ($1, $2, $3, $4) RETURNING *',
      [user.id, b.latitude ?? null, b.longitude ?? null, b.message?.trim() || null],
    )
    const alert = toSos(rows[0]!)
    await audit(db, user.id, 'sos.create', { type: 'sos_alert', id: String(alert.id) })
    deps.realtime.toStaff('sos.update', alert)
    return { status: 201, body: alert }
  })

  r.get('/admin/sos', { operationId: 'listSosAlerts', roles: [...STAFF] }, async () => {
    const { rows } = await db.query(
      `SELECT * FROM sos_alerts
        WHERE status <> 'afgehandeld' OR resolved_at > now() - interval '2 hours'
        ORDER BY (status = 'afgehandeld'), created_at
        LIMIT 500`,
    )
    return { status: 200, body: rows.map(toSos) }
  })

  r.patch('/admin/sos/:sosId', { operationId: 'updateSosAlert', roles: [...STAFF] }, async (ctx) => {
    const user = requireUser(ctx)
    const { status } = ctx.body as { status: string }
    const { rows } = await db.query(
      `UPDATE sos_alerts
          SET status = $2::sos_status, handled_by = $3,
              resolved_at = CASE WHEN $2::sos_status = 'afgehandeld' THEN coalesce(resolved_at, now()) ELSE NULL END
        WHERE id = $1 RETURNING *`,
      [uuidParam(ctx, 'sosId'), status, user.id],
    )
    if (!rows[0]) throw notFound()
    const alert = toSos(rows[0])
    await audit(db, user.id, 'sos.update', { type: 'sos_alert', id: String(alert.id) }, { status })
    deps.realtime.toStaff('sos.update', alert)
    if (alert.userId) deps.realtime.toUser(String(alert.userId), 'sos.update', alert)
    return { status: 200, body: alert }
  })

  // ------------------------------------------------------------- timetable beheren
  r.post('/admin/performances', { operationId: 'createPerformance', roles: [...STAFF] }, async (ctx) => {
    const user = requireUser(ctx)
    const b = ctx.body as { stageId: string; artist: string; description?: string; startsAt: string; endsAt: string; signupCapacity?: number }
    if (new Date(b.endsAt) <= new Date(b.startsAt)) throw badRequest('De eindtijd moet na de begintijd liggen.')
    const stage = await db.query('SELECT 1 FROM stages WHERE id = $1', [b.stageId])
    if (!stage.rowCount) throw badRequest('Onbekend podium.')
    const { rows } = await db.query(
      `INSERT INTO performances (stage_id, artist, description, starts_at, ends_at, signup_capacity)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING ${PERFORMANCE_COLUMNS}`,
      [b.stageId, b.artist.trim(), b.description?.trim() || null, b.startsAt, b.endsAt, b.signupCapacity ?? null],
    )
    const performance = toPerformance(rows[0]!)
    await audit(db, user.id, 'performance.create', { type: 'performance', id: String(performance.id) })
    deps.realtime.toAll('timetable.update', performance)
    return { status: 201, body: performance }
  })

  r.patch('/admin/performances/:performanceId', { operationId: 'updatePerformance', roles: [...STAFF] }, async (ctx) => {
    const user = requireUser(ctx)
    const id = uuidParam(ctx, 'performanceId')
    const b = ctx.body as Partial<{ stageId: string; startsAt: string; endsAt: string; status: string; description: string }>
    const { rows } = await db.query(
      `UPDATE performances SET
          stage_id    = coalesce($2, stage_id),
          starts_at   = coalesce($3, starts_at),
          ends_at     = coalesce($4, ends_at),
          status      = coalesce($5::performance_status, status),
          description = coalesce($6, description)
        WHERE id = $1 RETURNING ${PERFORMANCE_COLUMNS}`,
      [id, b.stageId ?? null, b.startsAt ?? null, b.endsAt ?? null, b.status ?? null, b.description ?? null],
    ).catch((error: { code?: string }) => {
      // 23514 = CHECK (eindtijd na begintijd), 23503 = onbekend podium
      if (error.code === '23514' || error.code === '23503') throw badRequest('Ongeldige tijden of podium.')
      throw error
    })
    if (!rows[0]) throw notFound()
    const performance = toPerformance(rows[0])
    await audit(db, user.id, 'performance.update', { type: 'performance', id }, b)
    deps.realtime.toAll('timetable.update', performance)

    // Iedereen die dit optreden in zijn timetable heeft, krijgt een melding
    const fans = await db.query<{ user_id: string }>('SELECT user_id FROM timetable_entries WHERE performance_id = $1', [id])
    const statusText: Record<string, string> = {
      vertraagd: 'is vertraagd',
      verplaatst: 'is verplaatst',
      geannuleerd: 'is geannuleerd',
      gepland: 'heeft een nieuwe tijd',
    }
    void deps.push.toUsers(
      fans.rows.map((f) => f.user_id),
      {
        title: String(performance.artist),
        body: `${String(performance.artist)} ${statusText[String(performance.status)] ?? 'is gewijzigd'}`,
        tag: `performance-${id}`,
        url: '/?tab=timetable',
      },
    )
    return { status: 200, body: performance }
  })

  // ------------------------------------------------------------- tickets
  r.post('/admin/tickets/import', { operationId: 'importTickets', roles: ['beheerder'] }, async (ctx) => {
    const user = requireUser(ctx)
    const { tickets } = ctx.body as { tickets: { code: string; ticketType?: string; validFrom: string; validUntil: string }[] }
    let imported = 0
    for (const t of tickets) {
      if (new Date(t.validUntil) <= new Date(t.validFrom)) continue
      const { rowCount } = await db.query(
        `INSERT INTO tickets (code_hash, ticket_type, valid_from, valid_until) VALUES ($1, $2, $3, $4)
         ON CONFLICT (code_hash) DO NOTHING`,
        [sha256(t.code.trim().toUpperCase()), t.ticketType ?? 'weekend', t.validFrom, t.validUntil],
      )
      imported += rowCount ?? 0
    }
    await audit(db, user.id, 'ticket.import', undefined, { imported, total: tickets.length })
    return { status: 200, body: { imported, skipped: tickets.length - imported } }
  })
}
