import type { Deps } from '../app.ts'
import { audit, transaction } from '../db.ts'
import { HttpError, badRequest, conflict, requireUser, unauthorized, type Router } from '../http.ts'
import { hashPassword, isWeakPassword, randomToken, sha256, signAccessToken, verifyPassword } from '../security.ts'

const MAX_FAILED_LOGINS = 10
const LOCK_MINUTES = 15

interface UserRow {
  id: string
  role: 'bezoeker' | 'organisatie' | 'beheerder'
  password_hash: string
  failed_logins: number
  locked_until: Date | null
  blocked_at: Date | null
}

export function authRoutes(r: Router, deps: Deps): void {
  const { db, config } = deps
  const strict = { limit: 10, windowMs: 60_000 }

  async function issueTokens(user: { id: string; role: UserRow['role'] }, userAgent: string | undefined) {
    const refreshToken = randomToken()
    await db.query(
      `INSERT INTO sessions (user_id, refresh_token_hash, user_agent, expires_at)
       VALUES ($1, $2, $3, now() + make_interval(days => $4))`,
      [user.id, sha256(refreshToken), userAgent?.slice(0, 200) ?? null, config.refreshTokenTtlDays],
    )
    return {
      accessToken: await signAccessToken(user, config.jwtSecret, config.accessTokenTtlSeconds),
      refreshToken,
      expiresIn: config.accessTokenTtlSeconds,
    }
  }

  r.post('/auth/register', { operationId: 'register', auth: 'none', rateLimit: { limit: 5, windowMs: 60_000 } }, async (ctx) => {
    const body = ctx.body as { ticketCode: string; email: string; password: string; displayName: string; locale?: 'nl' | 'en' }
    const email = body.email.trim().toLowerCase()
    if (isWeakPassword(body.password, email)) throw badRequest('Kies een sterker wachtwoord.')
    const displayName = body.displayName.trim()
    if (!displayName) throw badRequest('Het veld "displayName" is te kort.')

    const passwordHash = await hashPassword(body.password)
    const user = await transaction(db, async (tx) => {
      const ticket = await tx.query<{ id: string }>(
        `SELECT id FROM tickets
          WHERE code_hash = $1 AND status = 'geldig' AND valid_until > now()
          FOR UPDATE`,
        [sha256(body.ticketCode.trim().toUpperCase())],
      )
      const taken = await tx.query('SELECT 1 FROM users WHERE email = $1', [email])
      // Eén melding voor beide gevallen, zodat niet te achterhalen is wat er speelt
      if (!ticket.rows[0] || taken.rowCount) throw conflict('Dit ticket of e-mailadres kan niet gebruikt worden.')

      const inserted = await tx.query<{ id: string; role: UserRow['role'] }>(
        `INSERT INTO users (ticket_id, email, password_hash, display_name, locale)
         VALUES ($1, $2, $3, $4, $5) RETURNING id, role`,
        [ticket.rows[0].id, email, passwordHash, displayName, body.locale ?? 'nl'],
      )
      await tx.query(`UPDATE tickets SET status = 'gekoppeld' WHERE id = $1`, [ticket.rows[0].id])
      await audit(tx, inserted.rows[0]!.id, 'auth.register')
      return inserted.rows[0]!
    })
    return { status: 201, body: await issueTokens(user, ctx.req.headers['user-agent']) }
  })

  r.post('/auth/login', { operationId: 'login', auth: 'none', rateLimit: strict }, async (ctx) => {
    const { email, password } = ctx.body as { email: string; password: string }
    const { rows } = await db.query<UserRow>(
      'SELECT id, role, password_hash, failed_logins, locked_until, blocked_at FROM users WHERE email = $1',
      [email.trim().toLowerCase()],
    )
    const user = rows[0]
    const ok = await verifyPassword(user?.password_hash ?? null, password)
    const fail = () => new HttpError(401, 'unauthorized', 'E-mailadres of wachtwoord klopt niet.')

    if (!user) throw fail()
    if (user.locked_until && user.locked_until > new Date()) {
      await audit(db, user.id, 'auth.login_locked')
      throw fail()
    }
    if (!ok) {
      const failed = user.failed_logins + 1
      await db.query(
        `UPDATE users SET failed_logins = $2,
           locked_until = CASE WHEN $3::boolean THEN now() + make_interval(mins => $4) ELSE locked_until END
         WHERE id = $1`,
        [user.id, failed >= MAX_FAILED_LOGINS ? 0 : failed, failed >= MAX_FAILED_LOGINS, LOCK_MINUTES],
      )
      await audit(db, user.id, 'auth.login_failed', undefined, { ip: ctx.ip })
      throw fail()
    }
    // Pas na een goed wachtwoord melden dat het account geblokkeerd is: zo verraadt de melding
    // niet aan een vreemde dat dit e-mailadres een (geblokkeerd) account heeft
    if (user.blocked_at) {
      await audit(db, user.id, 'auth.login_blocked')
      throw new HttpError(403, 'forbidden', 'Dit account is geblokkeerd. Neem contact op met de organisatie.')
    }
    await db.query('UPDATE users SET failed_logins = 0, locked_until = NULL WHERE id = $1', [user.id])
    await audit(db, user.id, 'auth.login')
    return { status: 200, body: await issueTokens(user, ctx.req.headers['user-agent']) }
  })

  r.post('/auth/refresh', { operationId: 'refreshTokens', auth: 'none', rateLimit: { limit: 30, windowMs: 60_000 } }, async (ctx) => {
    const { refreshToken } = ctx.body as { refreshToken: string }
    const { rows } = await db.query<{ id: string; user_id: string; role: UserRow['role']; revoked_at: Date | null; expires_at: Date; blocked_at: Date | null }>(
      `SELECT s.id, s.user_id, u.role, s.revoked_at, s.expires_at, u.blocked_at
         FROM sessions s JOIN users u ON u.id = s.user_id
        WHERE s.refresh_token_hash = $1`,
      [sha256(refreshToken)],
    )
    const session = rows[0]
    if (!session) throw unauthorized()
    if (session.revoked_at) {
      // Hergebruik van een al geroteerd token: mogelijk gestolen → alle sessies intrekken
      await db.query('UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [session.user_id])
      await audit(db, session.user_id, 'auth.refresh_reuse')
      throw unauthorized()
    }
    if (session.expires_at <= new Date() || session.blocked_at) throw unauthorized()
    await db.query('UPDATE sessions SET revoked_at = now() WHERE id = $1', [session.id])
    return { status: 200, body: await issueTokens({ id: session.user_id, role: session.role }, ctx.req.headers['user-agent']) }
  })

  r.post('/auth/logout', { operationId: 'logout' }, async (ctx) => {
    const user = requireUser(ctx)
    // Zonder refresh-token in de body trekken we alle sessies van deze gebruiker in
    await db.query('UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [user.id])
    await audit(db, user.id, 'auth.logout')
    return { status: 204 }
  })
}
