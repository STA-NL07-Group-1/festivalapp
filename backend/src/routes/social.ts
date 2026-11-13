// Account, vrienden, locaties, pins en chat.
import type { Deps } from '../app.ts'
import { areFriends, audit, friendIds, transaction } from '../db.ts'
import { badRequest, forbidden, notFound, requireFestival, requireUser, uuidParam, type Router } from '../http.ts'
import { newFriendCode, normalizeCode, sha256 } from '../security.ts'
import { toFriend, toFriendLocation, toMe, toMessage, toPin } from './mappers.ts'

const FRIEND_CODE_MINUTES = 10
const LOCATION_TTL_MINUTES = 10
const ME_COLUMNS = 'id, email, email_verified_at, display_name, theme, locale, share_location, share_timetable'

export function socialRoutes(r: Router, deps: Deps): void {
  const { db } = deps

  // ------------------------------------------------------------- account
  r.get('/me', { operationId: 'getMe' }, async (ctx) => {
    const user = requireUser(ctx)
    const { rows } = await db.query(`SELECT ${ME_COLUMNS} FROM users WHERE id = $1`, [user.id])
    if (!rows[0]) throw notFound()
    return { status: 200, body: toMe(rows[0], ctx) }
  })

  r.patch('/me', { operationId: 'updateMe' }, async (ctx) => {
    const user = requireUser(ctx)
    const body = ctx.body as Partial<{
      displayName: string
      theme: string
      locale: string
      shareLocation: boolean
      shareTimetable: boolean
    }>
    if (body.displayName !== undefined && !body.displayName.trim()) throw badRequest('Het veld "displayName" is te kort.')
    // Vaste kolomnamen; waarden altijd als parameter
    const columns: Record<string, string> = {
      displayName: 'display_name',
      theme: 'theme',
      locale: 'locale',
      shareLocation: 'share_location',
      shareTimetable: 'share_timetable',
    }
    const sets: string[] = []
    const values: unknown[] = [user.id]
    for (const [key, column] of Object.entries(columns)) {
      const value = body[key as keyof typeof body]
      if (value === undefined) continue
      values.push(typeof value === 'string' ? value.trim() : value)
      sets.push(`${column} = $${values.length}`)
    }
    const { rows } = await db.query(`UPDATE users SET ${sets.join(', ')} WHERE id = $1 RETURNING ${ME_COLUMNS}`, values)
    if (body.shareLocation === false) await removeLocation(user.id)
    return { status: 200, body: toMe(rows[0]!, ctx) }
  })

  r.delete('/me', { operationId: 'deleteMe' }, async (ctx) => {
    const user = requireUser(ctx)
    const friends = await friendIds(db, user.id)
    await transaction(db, async (tx) => {
      // Tickets weer vrijgeven, zodat de bezoeker opnieuw een account kan maken
      await tx.query(`UPDATE tickets SET status = 'geldig', user_id = NULL WHERE user_id = $1 AND status = 'gekoppeld'`, [user.id])
      await tx.query('DELETE FROM users WHERE id = $1', [user.id])
      await audit(tx, null, 'account.delete', { type: 'user', id: user.id })
    })
    deps.realtime.toUsers(friends, 'friend.removed', { userId: user.id })
    return { status: 204 }
  })

  // ------------------------------------------------------------- locatie
  async function removeLocation(userId: string) {
    const { rowCount } = await db.query('DELETE FROM locations WHERE user_id = $1', [userId])
    if (rowCount) deps.realtime.toUsers(await friendIds(db, userId), 'friend.location.removed', { userId })
  }

  r.put('/me/location', { operationId: 'updateMyLocation', rateLimit: { limit: 12, windowMs: 60_000 } }, async (ctx) => {
    const user = requireUser(ctx)
    const festivalId = requireFestival(ctx)
    const { latitude, longitude, accuracyM } = ctx.body as { latitude: number; longitude: number; accuracyM?: number }
    const { rows } = await db.query<{ share_location: boolean; display_name: string }>(
      'SELECT share_location, display_name FROM users WHERE id = $1',
      [user.id],
    )
    if (!rows[0]?.share_location) throw forbidden('Zet eerst "Locatie delen" aan.')
    const saved = await db.query(
      `INSERT INTO locations (user_id, festival_id, latitude, longitude, accuracy_m, recorded_at, expires_at)
       VALUES ($1, $6, $2, $3, $4, now(), now() + make_interval(mins => $5))
       ON CONFLICT (user_id) DO UPDATE SET festival_id = EXCLUDED.festival_id, latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude,
         accuracy_m = EXCLUDED.accuracy_m, recorded_at = EXCLUDED.recorded_at, expires_at = EXCLUDED.expires_at
       RETURNING user_id, latitude, longitude, accuracy_m, recorded_at`,
      [user.id, latitude, longitude, accuracyM ?? null, LOCATION_TTL_MINUTES, festivalId],
    )
    const event = toFriendLocation({ ...saved.rows[0], display_name: rows[0].display_name })
    // Alleen vrienden die op hetzelfde festival zijn zien waar je bent
    deps.realtime.toUsers(await friendIds(db, user.id), 'friend.location', event, festivalId)
    return { status: 204 }
  })

  r.delete('/me/location', { operationId: 'deleteMyLocation' }, async (ctx) => {
    await removeLocation(requireUser(ctx).id)
    return { status: 204 }
  })

  // ------------------------------------------------------------- vrienden
  r.post('/friend-codes', { operationId: 'createFriendCode', rateLimit: { limit: 10, windowMs: 60_000 } }, async (ctx) => {
    const user = requireUser(ctx)
    const code = newFriendCode()
    const { rows } = await transaction(db, async (tx) => {
      // Een nieuwe code maakt de vorige ongeldig
      await tx.query('DELETE FROM friend_codes WHERE user_id = $1 AND used_at IS NULL', [user.id])
      return tx.query<{ expires_at: Date }>(
        `INSERT INTO friend_codes (user_id, code_hash, expires_at)
         VALUES ($1, $2, now() + make_interval(mins => $3)) RETURNING expires_at`,
        [user.id, sha256(normalizeCode(code)), FRIEND_CODE_MINUTES],
      )
    })
    const qrPayload = `${deps.config.appUrl}/?vriend=${code}`
    return { status: 201, body: { code, qrPayload, expiresAt: rows[0]!.expires_at.toISOString() } }
  })

  r.get('/friends', { operationId: 'listFriends' }, async (ctx) => {
    const user = requireUser(ctx)
    const { rows } = await db.query(
      `SELECT u.id, u.display_name, f.created_at AS since
         FROM friendships f
         JOIN users u ON u.id = CASE WHEN f.user_a = $1 THEN f.user_b ELSE f.user_a END
        WHERE f.user_a = $1 OR f.user_b = $1
        ORDER BY lower(u.display_name)
        LIMIT 500`,
      [user.id],
    )
    return { status: 200, body: rows.map(toFriend) }
  })

  r.post('/friends', { operationId: 'addFriend', rateLimit: { limit: 10, windowMs: 60_000 } }, async (ctx) => {
    const user = requireUser(ctx)
    const { code } = ctx.body as { code: string }
    const invalid = () => notFound('Deze code is onbekend, verlopen of al gebruikt.')

    const friend = await transaction(db, async (tx) => {
      const { rows } = await tx.query<{ id: string; user_id: string }>(
        `SELECT id, user_id FROM friend_codes
          WHERE code_hash = $1 AND used_at IS NULL AND expires_at > now()
          FOR UPDATE`,
        [sha256(normalizeCode(code))],
      )
      const found = rows[0]
      if (!found || found.user_id === user.id) throw invalid()
      await tx.query('UPDATE friend_codes SET used_at = now(), used_by = $2 WHERE id = $1', [found.id, user.id])
      const [a, b] = user.id < found.user_id ? [user.id, found.user_id] : [found.user_id, user.id]
      await tx.query('INSERT INTO friendships (user_a, user_b) VALUES ($1, $2) ON CONFLICT DO NOTHING', [a, b])
      const result = await tx.query(
        `SELECT u.id, u.display_name, f.created_at AS since FROM users u
           JOIN friendships f ON f.user_a = $2 AND f.user_b = $3
          WHERE u.id = $1`,
        [found.user_id, a, b],
      )
      return result.rows[0]!
    })

    const me = await db.query('SELECT id, display_name FROM users WHERE id = $1', [user.id])
    deps.realtime.toUser(friend.id as string, 'friend.added', toFriend({ ...me.rows[0], since: friend.since }))
    return { status: 201, body: toFriend(friend) }
  })

  r.delete('/friends/:userId', { operationId: 'removeFriend' }, async (ctx) => {
    const user = requireUser(ctx)
    const other = uuidParam(ctx, 'userId')
    const [a, b] = user.id < other ? [user.id, other] : [other, user.id]
    const { rowCount } = await db.query('DELETE FROM friendships WHERE user_a = $1 AND user_b = $2', [a, b])
    if (!rowCount) throw notFound()
    deps.realtime.toUser(other, 'friend.removed', { userId: user.id })
    return { status: 204 }
  })

  r.get('/friends/locations', { operationId: 'listFriendLocations' }, async (ctx) => {
    const user = requireUser(ctx)
    const { rows } = await db.query(
      `SELECT l.user_id, u.display_name, l.latitude, l.longitude, l.accuracy_m, l.recorded_at
         FROM friendships f
         JOIN users u ON u.id = CASE WHEN f.user_a = $1 THEN f.user_b ELSE f.user_a END
         JOIN locations l ON l.user_id = u.id
        WHERE (f.user_a = $1 OR f.user_b = $1)
          AND l.festival_id = $2
          AND u.share_location AND l.expires_at > now()
        LIMIT 500`,
      [user.id, requireFestival(ctx)],
    )
    return { status: 200, body: rows.map(toFriendLocation) }
  })

  // ------------------------------------------------------------- pins
  r.get('/pins', { operationId: 'listPins' }, async (ctx) => {
    const user = requireUser(ctx)
    const { rows } = await db.query(
      `SELECT p.* FROM pins p
        WHERE p.festival_id = $2
          AND (p.user_id = $1
           OR (p.visibility = 'vrienden' AND EXISTS (
                SELECT 1 FROM friendships f
                 WHERE (f.user_a = $1 AND f.user_b = p.user_id) OR (f.user_b = $1 AND f.user_a = p.user_id))))
        ORDER BY p.created_at DESC
        LIMIT 1000`,
      [user.id, requireFestival(ctx)],
    )
    return { status: 200, body: rows.map(toPin) }
  })

  r.post('/pins', { operationId: 'createPin', rateLimit: { limit: 30, windowMs: 60_000 } }, async (ctx) => {
    const user = requireUser(ctx)
    const body = ctx.body as { label: string; latitude: number; longitude: number; visibility?: string }
    const festivalId = requireFestival(ctx)
    const { rows } = await db.query(
      `INSERT INTO pins (user_id, festival_id, label, latitude, longitude, visibility)
       VALUES ($1, $6, $2, $3, $4, $5) RETURNING *`,
      [user.id, body.label.trim(), body.latitude, body.longitude, body.visibility ?? 'vrienden', festivalId],
    )
    const pin = toPin(rows[0]!)
    if (pin.visibility === 'vrienden') deps.realtime.toUsers(await friendIds(db, user.id), 'pin.created', pin, festivalId)
    return { status: 201, body: pin }
  })

  r.delete('/pins/:pinId', { operationId: 'deletePin' }, async (ctx) => {
    const user = requireUser(ctx)
    const { rowCount } = await db.query('DELETE FROM pins WHERE id = $1 AND user_id = $2', [uuidParam(ctx, 'pinId'), user.id])
    if (!rowCount) throw notFound()
    return { status: 204 }
  })

  // ------------------------------------------------------------- chat
  r.get('/messages/:userId', { operationId: 'listMessages' }, async (ctx) => {
    const user = requireUser(ctx)
    const other = uuidParam(ctx, 'userId')
    if (!(await areFriends(db, user.id, other))) throw notFound()
    const limit = Math.min(Math.max(Number(ctx.query.get('limit') ?? 50) || 50, 1), 100)
    const before = ctx.query.get('before')
    if (before && Number.isNaN(Date.parse(before))) throw badRequest('Het veld "before" is ongeldig.')

    const { rows } = await db.query(
      `SELECT * FROM messages
        WHERE ((sender_id = $1 AND recipient_id = $2) OR (sender_id = $2 AND recipient_id = $1))
          AND ($3::timestamptz IS NULL OR created_at < $3)
        ORDER BY created_at DESC
        LIMIT $4`,
      [user.id, other, before, limit],
    )
    await db.query('UPDATE messages SET read_at = now() WHERE recipient_id = $1 AND sender_id = $2 AND read_at IS NULL', [
      user.id,
      other,
    ])
    return { status: 200, body: rows.map(toMessage) }
  })

  r.post('/messages/:userId', { operationId: 'sendMessage', rateLimit: { limit: 30, windowMs: 60_000 } }, async (ctx) => {
    const user = requireUser(ctx)
    const other = uuidParam(ctx, 'userId')
    if (!(await areFriends(db, user.id, other))) throw notFound()
    const { body } = ctx.body as { body: string }
    if (!body.trim()) throw badRequest('Het veld "body" is te kort.')
    const { rows } = await db.query(
      'INSERT INTO messages (sender_id, recipient_id, body) VALUES ($1, $2, $3) RETURNING *',
      [user.id, other, body.trim()],
    )
    const message = toMessage(rows[0]!)
    deps.realtime.toUsers([other, user.id], 'chat.message', message)
    if (!deps.realtime.isOnline(other)) {
      const sender = await db.query<{ display_name: string }>('SELECT display_name FROM users WHERE id = $1', [user.id])
      void deps.push.toUsers([other], {
        title: sender.rows[0]?.display_name ?? 'Nieuw bericht',
        // Geen berichtinhoud in de melding: die kan op het vergrendelscherm staan
        body: 'Stuurde je een bericht',
        tag: `chat-${user.id}`,
        url: `/?chat=${user.id}`,
      })
    }
    return { status: 201, body: message }
  })
}
