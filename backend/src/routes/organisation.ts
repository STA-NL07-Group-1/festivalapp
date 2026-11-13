// Pushmeldingen, mededelingen, SOS, beheerportal en systeem.
import type { Deps } from '../app.ts'
import { audit } from '../db.ts'
import { ORGANISERS, STAFF, badRequest, notFound, requireFestival, requireUser, uuidParam, type Router } from '../http.ts'
import { festivalUserIds } from '../festival.ts'
import { sha256 } from '../security.ts'
import { TICKET_SECONDS } from '../wsTickets.ts'
import { PERFORMANCE_COLUMNS, toAnnouncement, toPerformance, toSos } from './mappers.ts'

export function organisationRoutes(r: Router, deps: Deps): void {
  const { db } = deps

  r.get('/health', { operationId: 'getHealth', auth: 'none' }, async () => {
    await db.query('SELECT 1')
    return { status: 200, body: { status: 'ok' } }
  })

  // ------------------------------------------------------------- realtime
  // Eenmalig ticket voor de WebSocket, zodat het access-token niet in de URL hoeft (zie wsTickets.ts)
  r.post('/realtime/ticket', { operationId: 'createRealtimeTicket', rateLimit: { limit: 30, windowMs: 60_000 } }, async (ctx) => {
    const user = requireUser(ctx)
    const ticket = deps.wsTickets.issue({ id: user.id, tokenExp: user.tokenExp ?? 0 })
    return { status: 201, body: { ticket, expiresIn: TICKET_SECONDS } }
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
  r.get('/announcements', { operationId: 'listAnnouncements' }, async (ctx) => {
    const { rows } = await db.query(
      `SELECT * FROM announcements WHERE festival_id = $1 AND (expires_at IS NULL OR expires_at > now())
        ORDER BY created_at DESC LIMIT 200`,
      [requireFestival(ctx)],
    )
    return { status: 200, body: rows.map(toAnnouncement) }
  })

  r.post('/admin/announcements', { operationId: 'createAnnouncement', roles: ORGANISERS }, async (ctx) => {
    const user = requireUser(ctx)
    const festivalId = requireFestival(ctx)
    const b = ctx.body as { level: string; titleNl: string; titleEn: string; bodyNl: string; bodyEn: string; expiresAt?: string }
    if (b.expiresAt && new Date(b.expiresAt) <= new Date()) throw badRequest('De verloopdatum ligt in het verleden.')
    const { rows } = await db.query(
      `INSERT INTO announcements (festival_id, author_id, level, title_nl, title_en, body_nl, body_en, expires_at)
       VALUES ($8, $1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [user.id, b.level, b.titleNl.trim(), b.titleEn.trim(), b.bodyNl.trim(), b.bodyEn.trim(), b.expiresAt ?? null, festivalId],
    )
    const announcement = toAnnouncement(rows[0]!)
    await audit(db, user.id, 'announcement.create', { type: 'announcement', id: String(announcement.id) }, { level: b.level })
    deps.realtime.toFestival(festivalId, 'announcement', announcement)
    if (b.level !== 'info') {
      // Alleen naar wie bij dit festival hoort: bezoekers met een ticket en het personeel
      // Noodberichten (urgent) gaan ook naar wie mededelingen heeft uitgezet
      void deps.push.toUsers(
        await festivalUserIds(db, festivalId),
        {
          title: b.level === 'nood' ? `⚠️ ${b.titleNl}` : b.titleNl,
          body: b.bodyNl,
          tag: `announcement-${announcement.id}`,
          url: '/?tab=meldingen',
          urgent: b.level === 'nood',
        },
        'announcement',
      )
    }
    return { status: 201, body: announcement }
  })

  // ------------------------------------------------------------- SOS
  r.post('/sos', { operationId: 'sendSos', rateLimit: { limit: 3, windowMs: 60_000 } }, async (ctx) => {
    const user = requireUser(ctx)
    const b = ctx.body as { latitude?: number; longitude?: number; message?: string }
    const festivalId = requireFestival(ctx)
    const { rows } = await db.query(
      'INSERT INTO sos_alerts (festival_id, user_id, latitude, longitude, message) VALUES ($5, $1, $2, $3, $4) RETURNING *',
      [user.id, b.latitude ?? null, b.longitude ?? null, b.message?.trim() || null, festivalId],
    )
    const alert = toSos(rows[0]!)
    await audit(db, user.id, 'sos.create', { type: 'sos_alert', id: String(alert.id) })
    // Naar al het personeel van dit festival: organisatie, EHBO en beveiliging
    deps.realtime.toStaff(festivalId, 'sos.update', alert)
    return { status: 201, body: alert }
  })

  r.get('/admin/sos', { operationId: 'listSosAlerts', roles: STAFF }, async (ctx) => {
    const { rows } = await db.query(
      `SELECT * FROM sos_alerts
        WHERE festival_id = $1 AND (status <> 'afgehandeld' OR resolved_at > now() - interval '2 hours')
        ORDER BY (status = 'afgehandeld'), created_at
        LIMIT 500`,
      [requireFestival(ctx)],
    )
    return { status: 200, body: rows.map(toSos) }
  })

  r.patch('/admin/sos/:sosId', { operationId: 'updateSosAlert', roles: STAFF }, async (ctx) => {
    const user = requireUser(ctx)
    const festivalId = requireFestival(ctx)
    const { status } = ctx.body as { status: string }
    const { rows } = await db.query(
      `UPDATE sos_alerts
          SET status = $2::sos_status, handled_by = $3,
              resolved_at = CASE WHEN $2::sos_status = 'afgehandeld' THEN coalesce(resolved_at, now()) ELSE NULL END
        WHERE id = $1 AND festival_id = $4 RETURNING *`,
      [uuidParam(ctx, 'sosId'), status, user.id, festivalId],
    )
    if (!rows[0]) throw notFound()
    const alert = toSos(rows[0])
    await audit(db, user.id, 'sos.update', { type: 'sos_alert', id: String(alert.id) }, { status })
    deps.realtime.toStaff(festivalId, 'sos.update', alert)
    if (alert.userId) deps.realtime.toUser(String(alert.userId), 'sos.update', alert)
    return { status: 200, body: alert }
  })

  // ------------------------------------------------------------- timetable beheren
  r.post('/admin/performances', { operationId: 'createPerformance', roles: ORGANISERS }, async (ctx) => {
    const user = requireUser(ctx)
    const b = ctx.body as { stageId: string; artist: string; description?: string; startsAt: string; endsAt: string; signupCapacity?: number }
    if (new Date(b.endsAt) <= new Date(b.startsAt)) throw badRequest('De eindtijd moet na de begintijd liggen.')
    const festivalId = requireFestival(ctx)
    const stage = await db.query('SELECT 1 FROM stages WHERE id = $1 AND festival_id = $2', [b.stageId, festivalId])
    if (!stage.rowCount) throw badRequest('Onbekend podium.')
    const { rows } = await db.query(
      `INSERT INTO performances (stage_id, artist, description, starts_at, ends_at, signup_capacity)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING ${PERFORMANCE_COLUMNS}`,
      [b.stageId, b.artist.trim(), b.description?.trim() || null, b.startsAt, b.endsAt, b.signupCapacity ?? null],
    )
    const performance = toPerformance(rows[0]!)
    await audit(db, user.id, 'performance.create', { type: 'performance', id: String(performance.id) })
    deps.realtime.toFestival(festivalId, 'timetable.update', performance)
    return { status: 201, body: performance }
  })

  r.patch('/admin/performances/:performanceId', { operationId: 'updatePerformance', roles: ORGANISERS }, async (ctx) => {
    const user = requireUser(ctx)
    const id = uuidParam(ctx, 'performanceId')
    const b = ctx.body as Partial<{ stageId: string; startsAt: string; endsAt: string; status: string; description: string }>
    const festivalId = requireFestival(ctx)
    // Het optreden en een eventueel nieuw podium moeten allebei bij dit festival horen
    if (b.stageId && !(await db.query('SELECT 1 FROM stages WHERE id = $1 AND festival_id = $2', [b.stageId, festivalId])).rowCount) {
      throw badRequest('Ongeldige tijden of podium.')
    }
    const { rows } = await db.query(
      `UPDATE performances SET
          stage_id    = coalesce($2, stage_id),
          starts_at   = coalesce($3, starts_at),
          ends_at     = coalesce($4, ends_at),
          status      = coalesce($5::performance_status, status),
          description = coalesce($6, description)
        WHERE id = $1 AND stage_id IN (SELECT id FROM stages WHERE festival_id = $7)
        RETURNING ${PERFORMANCE_COLUMNS}`,
      [id, b.stageId ?? null, b.startsAt ?? null, b.endsAt ?? null, b.status ?? null, b.description ?? null, festivalId],
    ).catch((error: { code?: string }) => {
      // 23514 = CHECK (eindtijd na begintijd), 23503 = onbekend podium
      if (error.code === '23514' || error.code === '23503') throw badRequest('Ongeldige tijden of podium.')
      throw error
    })
    if (!rows[0]) throw notFound()
    const performance = toPerformance(rows[0])
    await audit(db, user.id, 'performance.update', { type: 'performance', id }, b)
    deps.realtime.toFestival(festivalId, 'timetable.update', performance)

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
      'timetable',
    )
    return { status: 200, body: performance }
  })

  // ------------------------------------------------------------- tickets
  r.post('/admin/tickets/import', { operationId: 'importTickets', roles: ['beheerder'] }, async (ctx) => {
    const user = requireUser(ctx)
    const { tickets } = ctx.body as { tickets: { code: string; ticketType?: string; validFrom: string; validUntil: string }[] }
    const festivalId = requireFestival(ctx)
    let imported = 0
    for (const t of tickets) {
      if (new Date(t.validUntil) <= new Date(t.validFrom)) continue
      const { rowCount } = await db.query(
        `INSERT INTO tickets (festival_id, code_hash, ticket_type, valid_from, valid_until) VALUES ($5, $1, $2, $3, $4)
         ON CONFLICT (code_hash) DO NOTHING`,
        [sha256(t.code.trim().toUpperCase()), t.ticketType ?? 'weekend', t.validFrom, t.validUntil, festivalId],
      )
      imported += rowCount ?? 0
    }
    await audit(db, user.id, 'ticket.import', undefined, { imported, total: tickets.length })
    return { status: 200, body: { imported, skipped: tickets.length - imported } }
  })

  // Alleen aantallen van het gekozen festival: geen codes, geen namen
  r.get('/admin/tickets/stats', { operationId: 'getTicketStats', roles: ORGANISERS }, async (ctx) => {
    const festivalId = requireFestival(ctx)
    const { rows } = await db.query<{ ticket_type: string; total: number; linked: number; available: number; unusable: number }>(
      `SELECT ticket_type,
              count(*)::int AS total,
              count(*) FILTER (WHERE status = 'gekoppeld')::int AS linked,
              count(*) FILTER (WHERE status = 'geldig' AND user_id IS NULL AND valid_until > now())::int AS available,
              count(*) FILTER (WHERE status = 'ingetrokken' OR (status = 'geldig' AND valid_until <= now()))::int AS unusable
         FROM tickets
        WHERE festival_id = $1
        GROUP BY ticket_type
        ORDER BY ticket_type`,
      [festivalId],
    )
    const sum = (key: 'total' | 'linked' | 'available' | 'unusable') => rows.reduce((n, row) => n + row[key], 0)
    return {
      status: 200,
      body: {
        total: sum('total'),
        linked: sum('linked'),
        available: sum('available'),
        unusable: sum('unusable'),
        byType: rows.map((row) => ({ ticketType: row.ticket_type, total: row.total, linked: row.linked })),
      },
    }
  })
}
