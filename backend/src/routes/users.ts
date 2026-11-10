// Gebruikers beheren in het beheerportal: zoeken, VIP-ticket aan/uit en blokkeren.
// Alleen voor beheerders. Alleen bezoekers zijn hier te wijzigen; personeel niet.
import type { Deps } from '../app.ts'
import { audit, transaction } from '../db.ts'
import { badRequest, forbidden, notFound, requireUser, uuidParam, type Router } from '../http.ts'
import { toAdminUser } from './mappers.ts'

const USER_SELECT = `SELECT u.id, u.email, u.display_name, u.role, u.created_at, u.blocked_at, u.blocked_reason, t.ticket_type
                       FROM users u LEFT JOIN tickets t ON t.id = u.ticket_id`

type UpdateUserInput = {
  ticketType?: 'weekend' | 'dag' | 'vip'
  blocked?: boolean
  blockedReason?: string
}

export function userRoutes(r: Router, deps: Deps): void {
  const { db } = deps

  r.get('/admin/users', { operationId: 'listUsers', roles: ['beheerder'] }, async (ctx) => {
    const q = (ctx.query.get('q') ?? '').trim().slice(0, 100)
    // % en _ zijn jokertekens in LIKE: die moeten letterlijk gezocht worden
    const pattern = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`
    const { rows } = await db.query(
      `${USER_SELECT}
        WHERE $1 = '' OR u.display_name ILIKE $2 OR u.email::text ILIKE $2
        ORDER BY u.display_name, u.email
        LIMIT 100`,
      [q, pattern],
    )
    return { status: 200, body: rows.map(toAdminUser) }
  })

  r.patch('/admin/users/:userId', { operationId: 'updateUser', roles: ['beheerder'] }, async (ctx) => {
    const admin = requireUser(ctx)
    const id = uuidParam(ctx, 'userId')
    const b = ctx.body as UpdateUserInput
    const reason = b.blockedReason?.trim()
    if (b.blocked === true && !reason) throw badRequest('Geef een korte reden voor de blokkade.')
    if (id === admin.id) throw badRequest('Je kunt je eigen account hier niet wijzigen.')

    await transaction(db, async (tx) => {
      const { rows } = await tx.query<{ role: string; ticket_id: string | null }>('SELECT role, ticket_id FROM users WHERE id = $1 FOR UPDATE', [id])
      const target = rows[0]
      if (!target) throw notFound()
      if (target.role !== 'bezoeker') throw forbidden('Accounts van de organisatie kun je hier niet wijzigen.')

      if (b.ticketType !== undefined) {
        await tx.query('UPDATE tickets SET ticket_type = $2 WHERE id = $1', [target.ticket_id, b.ticketType])
        await audit(tx, admin.id, 'user.ticket_type', { type: 'user', id }, { ticketType: b.ticketType })
      }
      if (b.blocked === true) {
        await tx.query('UPDATE users SET blocked_at = now(), blocked_reason = $2 WHERE id = $1', [id, reason])
        // Meteen uitloggen en van de kaart halen
        await tx.query('UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [id])
        await tx.query('DELETE FROM locations WHERE user_id = $1', [id])
        // De reden staat bij het account, niet in het (onwisbare) auditlog
        await audit(tx, admin.id, 'user.block', { type: 'user', id })
      }
      if (b.blocked === false) {
        await tx.query('UPDATE users SET blocked_at = NULL, blocked_reason = NULL WHERE id = $1', [id])
        await audit(tx, admin.id, 'user.unblock', { type: 'user', id })
      }
    })

    const { rows } = await db.query(`${USER_SELECT} WHERE u.id = $1`, [id])
    return { status: 200, body: toAdminUser(rows[0]!) }
  })
}
