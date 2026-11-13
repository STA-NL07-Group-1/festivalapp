import type { Deps } from '../app.ts'
import { audit, transaction, type Queryable } from '../db.ts'
import { HttpError, badRequest, conflict, requireUser, unauthorized, type Router } from '../http.ts'
import { passwordChangedMail, resetMail, verifyMail, welcomeMail, type Mail } from '../mail.ts'
import { hashPassword, isWeakPassword, randomToken, sha256, signAccessToken, verifyPassword } from '../security.ts'

const MAX_FAILED_LOGINS = 10
const LOCK_MINUTES = 15
/** Hoe lang een link uit een mail werkt (de database staat maximaal 2 dagen en 1 uur toe) */
const VERIFY_MINUTES = 24 * 60
const RESET_MINUTES = 30
const INVALID_LINK = 'Deze link is ongeldig of verlopen.'

type Locale = 'nl' | 'en'

interface UserRow {
  id: string
  password_hash: string
  failed_logins: number
  locked_until: Date | null
  blocked_at: Date | null
}

export function authRoutes(r: Router, deps: Deps): void {
  const { db, config, mailer } = deps
  const strict = { limit: 10, windowMs: 60_000 }
  // Mails sturen kost geld en kan spam worden: hier een strengere grens
  const mailLimit = { limit: 3, windowMs: 60_000 }

  /** Nieuwe link voor in een mail. Oudere, nog ongebruikte links van hetzelfde soort werken daarna niet meer. */
  async function createEmailToken(q: Queryable, userId: string, purpose: 'verify' | 'reset'): Promise<string> {
    const token = randomToken()
    await q.query('UPDATE email_tokens SET used_at = now() WHERE user_id = $1 AND purpose = $2 AND used_at IS NULL', [userId, purpose])
    await q.query(
      `INSERT INTO email_tokens (user_id, purpose, token_hash, expires_at)
       VALUES ($1, $2, $3, now() + make_interval(mins => $4))`,
      [userId, purpose, sha256(token), purpose === 'reset' ? RESET_MINUTES : VERIFY_MINUTES],
    )
    return token
  }

  const appLink = (param: 'verify' | 'reset', token: string) => `${config.appUrl}/?${param}=${encodeURIComponent(token)}`

  // Niet wachten op de mail: het antwoord duurt dan niet langer als het account bestaat (en verraadt dat dus niet).
  // Een mislukte mail laat het verzoek niet mislukken; alleen de fout komt in de log, zonder e-mailadres.
  function sendInBackground(mail: Mail) {
    mailer.send(mail).catch((error: unknown) => console.error('[mail] versturen mislukt:', error instanceof Error ? error.message : error))
  }

  async function issueTokens(user: { id: string }, userAgent: string | undefined) {
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
          WHERE code_hash = $1 AND status = 'geldig' AND user_id IS NULL AND valid_until > now()
          FOR UPDATE`,
        [sha256(body.ticketCode.trim().toUpperCase())],
      )
      const taken = await tx.query('SELECT 1 FROM users WHERE email = $1', [email])
      // Eén melding voor beide gevallen, zodat niet te achterhalen is wat er speelt
      if (!ticket.rows[0] || taken.rowCount) throw conflict('Dit ticket of e-mailadres kan niet gebruikt worden.')

      const inserted = await tx.query<{ id: string }>(
        `INSERT INTO users (email, password_hash, display_name, locale)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [email, passwordHash, displayName, body.locale ?? 'nl'],
      )
      // Het ticket bepaalt bij welk festival dit account hoort; later kunnen er tickets bij (POST /me/tickets)
      await tx.query(`UPDATE tickets SET status = 'gekoppeld', user_id = $2 WHERE id = $1`, [ticket.rows[0].id, inserted.rows[0]!.id])
      await audit(tx, inserted.rows[0]!.id, 'auth.register')
      return { id: inserted.rows[0]!.id, verifyToken: await createEmailToken(tx, inserted.rows[0]!.id, 'verify') }
    })
    sendInBackground(welcomeMail(body.locale ?? 'nl', { to: email, name: displayName, verifyUrl: appLink('verify', user.verifyToken) }))
    return { status: 201, body: await issueTokens(user, ctx.req.headers['user-agent']) }
  })

  r.post('/auth/login', { operationId: 'login', auth: 'none', rateLimit: strict }, async (ctx) => {
    const { email, password } = ctx.body as { email: string; password: string }
    const { rows } = await db.query<UserRow>(
      'SELECT id, password_hash, failed_logins, locked_until, blocked_at FROM users WHERE email = $1',
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
    const { rows } = await db.query<{ id: string; user_id: string; revoked_at: Date | null; expires_at: Date; blocked_at: Date | null }>(
      `SELECT s.id, s.user_id, s.revoked_at, s.expires_at, u.blocked_at
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
    return { status: 200, body: await issueTokens({ id: session.user_id }, ctx.req.headers['user-agent']) }
  })

  // ------------------------------------------------------------- e-mailadres bevestigen
  r.post('/auth/verify-email', { operationId: 'verifyEmail', auth: 'none', rateLimit: strict }, async (ctx) => {
    const { token } = ctx.body as { token: string }
    const { rows } = await db.query<{ user_id: string }>(
      `UPDATE email_tokens SET used_at = now()
        WHERE token_hash = $1 AND purpose = 'verify' AND used_at IS NULL AND expires_at > now()
        RETURNING user_id`,
      [sha256(token)],
    )
    if (!rows[0]) throw badRequest(INVALID_LINK)
    await db.query('UPDATE users SET email_verified_at = COALESCE(email_verified_at, now()) WHERE id = $1', [rows[0].user_id])
    await audit(db, rows[0].user_id, 'auth.email_verified')
    return { status: 204 }
  })

  r.post('/me/verify-email', { operationId: 'resendVerifyEmail', rateLimit: mailLimit }, async (ctx) => {
    const user = requireUser(ctx)
    const { rows } = await db.query<{ email: string; locale: Locale; email_verified_at: Date | null }>(
      'SELECT email, locale, email_verified_at FROM users WHERE id = $1',
      [user.id],
    )
    const row = rows[0]
    // Al bevestigd: niets te doen
    if (row && !row.email_verified_at) {
      const token = await createEmailToken(db, user.id, 'verify')
      sendInBackground(verifyMail(row.locale, { to: row.email, verifyUrl: appLink('verify', token) }))
    }
    return { status: 204 }
  })

  // ------------------------------------------------------------- wachtwoord vergeten
  r.post('/auth/forgot-password', { operationId: 'forgotPassword', auth: 'none', rateLimit: mailLimit }, async (ctx) => {
    const { email } = ctx.body as { email: string }
    const { rows } = await db.query<{ id: string; email: string; locale: Locale; blocked_at: Date | null }>(
      'SELECT id, email, locale, blocked_at FROM users WHERE email = $1',
      [email.trim().toLowerCase()],
    )
    const user = rows[0]
    if (user && !user.blocked_at) {
      const token = await createEmailToken(db, user.id, 'reset')
      await audit(db, user.id, 'auth.reset_requested', undefined, { ip: ctx.ip })
      sendInBackground(resetMail(user.locale, { to: user.email, resetUrl: appLink('reset', token) }))
    }
    // Altijd hetzelfde antwoord, zodat niet te achterhalen is welke e-mailadressen een account hebben
    return { status: 204 }
  })

  r.post('/auth/reset-password', { operationId: 'resetPassword', auth: 'none', rateLimit: strict }, async (ctx) => {
    const { token, password } = ctx.body as { token: string; password: string }
    const user = await transaction(db, async (tx) => {
      const { rows } = await tx.query<{ token_id: string; user_id: string; email: string; locale: Locale }>(
        `SELECT t.id AS token_id, u.id AS user_id, u.email, u.locale
           FROM email_tokens t JOIN users u ON u.id = t.user_id
          WHERE t.token_hash = $1 AND t.purpose = 'reset' AND t.used_at IS NULL AND t.expires_at > now()
            AND u.blocked_at IS NULL
          FOR UPDATE OF t`,
        [sha256(token)],
      )
      const row = rows[0]
      if (!row) throw badRequest(INVALID_LINK)
      // Eerst het wachtwoord controleren: is het te zwak, dan blijft de link bruikbaar voor een nieuwe poging
      if (isWeakPassword(password, row.email)) throw badRequest('Kies een sterker wachtwoord.')
      await tx.query(
        `UPDATE users SET password_hash = $2, failed_logins = 0, locked_until = NULL,
                email_verified_at = COALESCE(email_verified_at, now())
          WHERE id = $1`,
        [row.user_id, await hashPassword(password)],
      )
      await tx.query(`UPDATE email_tokens SET used_at = now() WHERE user_id = $1 AND purpose = 'reset' AND used_at IS NULL`, [row.user_id])
      // Wie het oude wachtwoord kende, is nu overal uitgelogd. Verwijderen en niet intrekken: een ingetrokken
      // refresh-token dat terugkomt geldt als gestolen (zie /auth/refresh) en zou ook de nieuwe sessies uitloggen.
      await tx.query('DELETE FROM sessions WHERE user_id = $1', [row.user_id])
      await audit(tx, row.user_id, 'auth.password_reset', undefined, { ip: ctx.ip })
      return row
    })
    sendInBackground(passwordChangedMail(user.locale, { to: user.email }))
    return { status: 204 }
  })

  // ------------------------------------------------------------- wachtwoord wijzigen (ingelogd)
  r.put('/me/password', { operationId: 'changePassword', rateLimit: strict }, async (ctx) => {
    const current = requireUser(ctx)
    const { currentPassword, newPassword } = ctx.body as { currentPassword: string; newPassword: string }
    const { rows } = await db.query<{ email: string; locale: Locale; password_hash: string }>(
      'SELECT email, locale, password_hash FROM users WHERE id = $1',
      [current.id],
    )
    const row = rows[0]
    if (!row) throw unauthorized()
    // 400 en geen 401: bij 401 logt de app je uit
    if (!(await verifyPassword(row.password_hash, currentPassword))) {
      await audit(db, current.id, 'auth.password_change_failed', undefined, { ip: ctx.ip })
      throw badRequest('Je huidige wachtwoord klopt niet.')
    }
    if (isWeakPassword(newPassword, row.email)) throw badRequest('Kies een sterker wachtwoord.')
    await transaction(db, async (tx) => {
      await tx.query('UPDATE users SET password_hash = $2 WHERE id = $1', [current.id, await hashPassword(newPassword)])
      // Andere apparaten uitloggen; dit apparaat krijgt hieronder nieuwe tokens. Verwijderen en niet intrekken:
      // anders logt een ander apparaat dat later zijn oude token probeert ook deze nieuwe sessie uit (zie /auth/refresh).
      await tx.query('DELETE FROM sessions WHERE user_id = $1', [current.id])
      await audit(tx, current.id, 'auth.password_changed')
    })
    sendInBackground(passwordChangedMail(row.locale, { to: row.email }))
    return { status: 200, body: await issueTokens(current, ctx.req.headers['user-agent']) }
  })

  r.post('/auth/logout', { operationId: 'logout' }, async (ctx) => {
    const user = requireUser(ctx)
    // Zonder refresh-token in de body trekken we alle sessies van deze gebruiker in
    await db.query('UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [user.id])
    await audit(db, user.id, 'auth.logout')
    return { status: 204 }
  })
}
