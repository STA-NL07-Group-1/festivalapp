// Festivals, tickets toevoegen, het team van een festival en de eigenaren van het platform.
//
// Wie mag wat:
//   sudo         → alles; de enige die eigenaren en beheerders aanwijst
//   eigenaar     → elk festival beheren, festivals aanmaken, organisatoren aanwijzen
//   beheerder    → één festival beheren, organisatoren aanwijzen
//   organisatie  → EHBO en beveiliging aanwijzen, de bezoekers van het eigen festival beheren
import type { Deps } from '../app.ts'
import { audit, transaction } from '../db.ts'
import { canAssign, loadAccess } from '../festival.ts'
import { ORGANISERS, badRequest, conflict, forbidden, notFound, requireFestival, requireUser, uuidParam, type FestivalRole, type Router } from '../http.ts'
import { hashPassword, isWeakPassword, sha256 } from '../security.ts'
import { toFestival, toOwner, toTeamMember } from './mappers.ts'

const TEAM_SELECT = `SELECT m.user_id, u.email, u.display_name, m.role, m.created_at
                       FROM festival_members m JOIN users u ON u.id = m.user_id`

export function festivalRoutes(r: Router, deps: Deps): void {
  const { db } = deps

  async function myFestivals(userId: string) {
    const access = await loadAccess(db, userId)
    return (access?.festivals ?? []).map(toFestival)
  }

  // ------------------------------------------------------------- mijn festivals
  // Bezoekers zien alleen festivals waar ze een ticket voor hebben en die nog niet zijn afgelopen
  r.get('/festivals', { operationId: 'listMyFestivals' }, async (ctx) => {
    return { status: 200, body: await myFestivals(requireUser(ctx).id) }
  })

  r.post('/me/tickets', { operationId: 'addMyTicket', rateLimit: { limit: 5, windowMs: 60_000 } }, async (ctx) => {
    const user = requireUser(ctx)
    const { ticketCode } = ctx.body as { ticketCode: string }
    await transaction(db, async (tx) => {
      const { rows } = await tx.query<{ id: string; festival_id: string }>(
        `SELECT t.id, t.festival_id FROM tickets t JOIN festivals f ON f.id = t.festival_id
          WHERE t.code_hash = $1 AND t.status = 'geldig' AND t.user_id IS NULL
            AND t.valid_until > now() AND f.ends_at > now()
          FOR UPDATE OF t`,
        [sha256(ticketCode.trim().toUpperCase())],
      )
      const ticket = rows[0]
      if (!ticket) throw conflict('Dit ticket kan niet gebruikt worden.')
      const own = await tx.query('SELECT 1 FROM tickets WHERE user_id = $1 AND festival_id = $2', [user.id, ticket.festival_id])
      if (own.rowCount) throw conflict('Je hebt al een ticket voor dit festival.')
      await tx.query(`UPDATE tickets SET status = 'gekoppeld', user_id = $2 WHERE id = $1`, [ticket.id, user.id])
      await audit(tx, user.id, 'ticket.add', { type: 'ticket', id: ticket.id })
    })
    return { status: 201, body: await myFestivals(user.id) }
  })

  // ------------------------------------------------------------- festivals beheren
  r.post('/admin/festivals', { operationId: 'createFestival', platform: ['eigenaar', 'sudo'] }, async (ctx) => {
    const user = requireUser(ctx)
    const b = ctx.body as { name: string; startsAt: string; endsAt: string }
    const name = b.name.trim()
    if (!name) throw badRequest('Geef het festival een naam.')
    if (new Date(b.endsAt) <= new Date(b.startsAt)) throw badRequest('De einddatum moet na de begindatum liggen.')
    const { rows } = await db.query<{ id: string; name: string; starts_at: Date; ends_at: Date }>(
      'INSERT INTO festivals (name, starts_at, ends_at) VALUES ($1, $2, $3) RETURNING id, name, starts_at, ends_at',
      [name, b.startsAt, b.endsAt],
    )
    const f = rows[0]!
    await audit(db, user.id, 'festival.create', { type: 'festival', id: f.id })
    return { status: 201, body: toFestival({ id: f.id, name: f.name, startsAt: f.starts_at, endsAt: f.ends_at, role: 'beheerder' }) }
  })

  r.patch('/admin/festival', { operationId: 'updateFestival', roles: ['beheerder'] }, async (ctx) => {
    const user = requireUser(ctx)
    const festivalId = requireFestival(ctx)
    const b = ctx.body as Partial<{ name: string; startsAt: string; endsAt: string }>
    if (b.name !== undefined && !b.name.trim()) throw badRequest('Geef het festival een naam.')
    const { rows } = await db
      .query<{ id: string; name: string; starts_at: Date; ends_at: Date }>(
        `UPDATE festivals SET name = coalesce($2, name), starts_at = coalesce($3, starts_at), ends_at = coalesce($4, ends_at)
          WHERE id = $1 RETURNING id, name, starts_at, ends_at`,
        [festivalId, b.name?.trim() ?? null, b.startsAt ?? null, b.endsAt ?? null],
      )
      .catch((error: { code?: string }) => {
        // 23514 = CHECK (einddatum na begindatum)
        if (error.code === '23514') throw badRequest('De einddatum moet na de begindatum liggen.')
        throw error
      })
    const f = rows[0]!
    await audit(db, user.id, 'festival.update', { type: 'festival', id: festivalId }, b)
    return { status: 200, body: toFestival({ id: f.id, name: f.name, startsAt: f.starts_at, endsAt: f.ends_at, role: user.role }) }
  })

  // ------------------------------------------------------------- team van dit festival
  r.get('/admin/team', { operationId: 'listTeam', roles: ORGANISERS }, async (ctx) => {
    const { rows } = await db.query(`${TEAM_SELECT} WHERE m.festival_id = $1 ORDER BY m.role, lower(u.display_name) LIMIT 500`, [requireFestival(ctx)])
    return { status: 200, body: rows.map(toTeamMember) }
  })

  // Iemand een rol geven. Bestaat het account nog niet, dan maken we het aan met een tijdelijk wachtwoord.
  r.put('/admin/team', { operationId: 'setTeamMember', roles: ORGANISERS, rateLimit: { limit: 20, windowMs: 60_000 } }, async (ctx) => {
    const actor = requireUser(ctx)
    const festivalId = requireFestival(ctx)
    const b = ctx.body as { email: string; role: FestivalRole; displayName?: string; password?: string }
    const email = b.email.trim().toLowerCase()
    if (!canAssign(actor, b.role)) throw forbidden('Deze rol mag je niet uitdelen.')

    const existing = await db.query<{ id: string }>('SELECT id FROM users WHERE email = $1', [email])
    let passwordHash: string | null = null
    if (!existing.rows[0]) {
      const displayName = b.displayName?.trim()
      if (!displayName || !b.password) throw badRequest('Er is nog geen account met dit e-mailadres. Vul een naam en een tijdelijk wachtwoord in.')
      if (b.password.length < 12 || isWeakPassword(b.password, email)) throw badRequest('Kies een sterker wachtwoord (minstens 12 tekens).')
      passwordHash = await hashPassword(b.password)
    }

    const userId = await transaction(db, async (tx) => {
      let id = existing.rows[0]?.id
      if (!id) {
        const created = await tx.query<{ id: string }>(
          'INSERT INTO users (email, password_hash, display_name) VALUES ($1, $2, $3) ON CONFLICT (email) DO NOTHING RETURNING id',
          [email, passwordHash, b.displayName!.trim()],
        )
        if (!created.rows[0]) throw conflict('Dit account is zojuist door iemand anders aangemaakt. Probeer het opnieuw.')
        id = created.rows[0].id
        await audit(tx, actor.id, 'account.create_staff', { type: 'user', id })
      }
      if (id === actor.id) throw badRequest('Je kunt je eigen rol niet wijzigen.')
      // Wie nu al een hogere rol heeft dan jij mag uitdelen, kun je niet omzetten
      const current = await tx.query<{ role: FestivalRole }>('SELECT role FROM festival_members WHERE festival_id = $1 AND user_id = $2 FOR UPDATE', [festivalId, id])
      if (current.rows[0] && !canAssign(actor, current.rows[0].role)) throw forbidden('De rol van deze persoon mag je niet wijzigen.')
      await tx.query(
        `INSERT INTO festival_members (festival_id, user_id, role, added_by) VALUES ($1, $2, $3, $4)
         ON CONFLICT (festival_id, user_id) DO UPDATE SET role = EXCLUDED.role, added_by = EXCLUDED.added_by`,
        [festivalId, id, b.role, actor.id],
      )
      await audit(tx, actor.id, 'team.set', { type: 'user', id }, { festivalId, role: b.role })
      return id
    })
    const { rows } = await db.query(`${TEAM_SELECT} WHERE m.festival_id = $1 AND m.user_id = $2`, [festivalId, userId])
    return { status: 200, body: toTeamMember(rows[0]!) }
  })

  r.delete('/admin/team/:userId', { operationId: 'removeTeamMember', roles: ORGANISERS }, async (ctx) => {
    const actor = requireUser(ctx)
    const festivalId = requireFestival(ctx)
    const id = uuidParam(ctx, 'userId')
    if (id === actor.id) throw badRequest('Je kunt jezelf niet uit het team halen.')
    await transaction(db, async (tx) => {
      const current = await tx.query<{ role: FestivalRole }>('SELECT role FROM festival_members WHERE festival_id = $1 AND user_id = $2 FOR UPDATE', [festivalId, id])
      if (!current.rows[0]) throw notFound()
      if (!canAssign(actor, current.rows[0].role)) throw forbidden('Deze persoon mag je niet uit het team halen.')
      await tx.query('DELETE FROM festival_members WHERE festival_id = $1 AND user_id = $2', [festivalId, id])
      await audit(tx, actor.id, 'team.remove', { type: 'user', id }, { festivalId })
    })
    return { status: 204 }
  })

  // ------------------------------------------------------------- eigenaren (alleen sudo)
  r.get('/admin/owners', { operationId: 'listOwners', platform: ['sudo'] }, async () => {
    const { rows } = await db.query('SELECT id, email, display_name, platform_role FROM users WHERE platform_role IS NOT NULL ORDER BY platform_role DESC, lower(display_name)')
    return { status: 200, body: rows.map(toOwner) }
  })

  r.put('/admin/owners', { operationId: 'addOwner', platform: ['sudo'], rateLimit: { limit: 20, windowMs: 60_000 } }, async (ctx) => {
    const actor = requireUser(ctx)
    const email = (ctx.body as { email: string }).email.trim().toLowerCase()
    const { rows } = await db.query(
      `UPDATE users SET platform_role = 'eigenaar' WHERE email = $1 AND platform_role IS DISTINCT FROM 'sudo'
       RETURNING id, email, display_name, platform_role`,
      [email],
    )
    if (!rows[0]) throw notFound('Er is geen account met dit e-mailadres.')
    await audit(db, actor.id, 'owner.add', { type: 'user', id: String(rows[0].id) })
    return { status: 200, body: toOwner(rows[0]) }
  })

  r.delete('/admin/owners/:userId', { operationId: 'removeOwner', platform: ['sudo'] }, async (ctx) => {
    const actor = requireUser(ctx)
    const id = uuidParam(ctx, 'userId')
    const { rowCount } = await db.query(`UPDATE users SET platform_role = NULL WHERE id = $1 AND platform_role = 'eigenaar'`, [id])
    if (!rowCount) throw notFound()
    await audit(db, actor.id, 'owner.remove', { type: 'user', id })
    return { status: 204 }
  })
}
