// Bezoekers beheren in het beheerportal: zoeken, VIP-ticket aan/uit en blokkeren.
// Voor de organisatie en de beheerder van een festival, en alleen voor bezoekers met een
// ticket van DAT festival. Personeel staat op de pagina Team.
import type { Deps } from '../app.ts'
import { audit, transaction } from '../db.ts'
import { ORGANISERS, badRequest, forbidden, notFound, requireFestival, requireUser, uuidParam, type Router } from '../http.ts'
import { toAdminUser } from './mappers.ts'

// $1 = festival. Alleen wie een ticket van dit festival heeft en er geen personeel is.
const USER_SELECT = `SELECT u.id, u.email, u.display_name, u.created_at, u.blocked_at, u.blocked_reason,
                            t.ticket_type, b.created_at AS festival_blocked_at, b.reason AS festival_block_reason
                       FROM tickets t
                       JOIN users u ON u.id = t.user_id
                       LEFT JOIN festival_blocks b ON b.festival_id = t.festival_id AND b.user_id = u.id
                      WHERE t.festival_id = $1 AND t.status = 'gekoppeld'
                        AND u.platform_role IS NULL
                        AND NOT EXISTS (SELECT 1 FROM festival_members m WHERE m.festival_id = t.festival_id AND m.user_id = u.id)`

type UpdateUserInput = {
  ticketType?: 'weekend' | 'dag' | 'vip'
  blocked?: boolean
  blockedReason?: string
  /** 'festival' (standaard) = alleen dit festival, 'alle' = alle festivals (alleen eigenaar en sudo) */
  blockScope?: 'festival' | 'alle'
}

export function userRoutes(r: Router, deps: Deps): void {
  const { db } = deps

  r.get('/admin/users', { operationId: 'listUsers', roles: ORGANISERS }, async (ctx) => {
    const q = (ctx.query.get('q') ?? '').trim().slice(0, 100)
    // % en _ zijn jokertekens in LIKE: die moeten letterlijk gezocht worden
    const pattern = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`
    const { rows } = await db.query(
      `${USER_SELECT}
          AND ($2 = '' OR u.display_name ILIKE $3 OR u.email::text ILIKE $3)
        ORDER BY u.display_name, u.email
        LIMIT 100`,
      [requireFestival(ctx), q, pattern],
    )
    return { status: 200, body: rows.map(toAdminUser) }
  })

  r.patch('/admin/users/:userId', { operationId: 'updateUser', roles: ORGANISERS }, async (ctx) => {
    const admin = requireUser(ctx)
    const festivalId = requireFestival(ctx)
    const id = uuidParam(ctx, 'userId')
    const b = ctx.body as UpdateUserInput
    const reason = b.blockedReason?.trim()
    if (b.blocked === true && !reason) throw badRequest('Geef een korte reden voor de blokkade.')
    if (id === admin.id) throw badRequest('Je kunt je eigen account hier niet wijzigen.')
    const everywhere = b.blockScope === 'alle'
    if (everywhere && !admin.platformRole) throw forbidden('Alleen de eigenaar kan iemand voor alle festivals blokkeren.')

    await transaction(db, async (tx) => {
      // Bestaat deze bezoeker bij dit festival? Anders 404: zo kun je niet aftasten wie er bij andere festivals is
      const { rows } = await tx.query<{ blocked_at: Date | null }>(`${USER_SELECT} AND u.id = $2 FOR UPDATE OF u`, [festivalId, id])
      const target = rows[0]
      if (!target) throw notFound()

      if (b.ticketType !== undefined) {
        await tx.query('UPDATE tickets SET ticket_type = $3 WHERE festival_id = $1 AND user_id = $2', [festivalId, id, b.ticketType])
        await audit(tx, admin.id, 'user.ticket_type', { type: 'user', id }, { ticketType: b.ticketType, festivalId })
      }
      if (b.blocked === true && everywhere) {
        await tx.query('UPDATE users SET blocked_at = now(), blocked_reason = $2 WHERE id = $1', [id, reason])
        // Meteen uitloggen en van de kaart halen
        await tx.query('UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [id])
        await tx.query('DELETE FROM locations WHERE user_id = $1', [id])
        // De reden staat bij het account, niet in het (onwisbare) auditlog
        await audit(tx, admin.id, 'user.block', { type: 'user', id }, { scope: 'alle' })
      }
      if (b.blocked === true && !everywhere) {
        await tx.query(
          `INSERT INTO festival_blocks (festival_id, user_id, reason, blocked_by) VALUES ($1, $2, $3, $4)
           ON CONFLICT (festival_id, user_id) DO UPDATE SET reason = EXCLUDED.reason, blocked_by = EXCLUDED.blocked_by`,
          [festivalId, id, reason, admin.id],
        )
        await tx.query('DELETE FROM locations WHERE user_id = $1 AND festival_id = $2', [id, festivalId])
        await audit(tx, admin.id, 'user.block', { type: 'user', id }, { scope: 'festival', festivalId })
      }
      if (b.blocked === false) {
        if (target.blocked_at) {
          if (!admin.platformRole) throw forbidden('Alleen de eigenaar kan een blokkade voor alle festivals opheffen.')
          await tx.query('UPDATE users SET blocked_at = NULL, blocked_reason = NULL WHERE id = $1', [id])
        }
        await tx.query('DELETE FROM festival_blocks WHERE festival_id = $1 AND user_id = $2', [festivalId, id])
        await audit(tx, admin.id, 'user.unblock', { type: 'user', id }, { festivalId })
      }
    })

    const { rows } = await db.query(`${USER_SELECT} AND u.id = $2`, [festivalId, id])
    return { status: 200, body: toAdminUser(rows[0]!) }
  })
}
