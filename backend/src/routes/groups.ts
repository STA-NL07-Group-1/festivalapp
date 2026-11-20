// Groepsapps: een groep maken met vrienden, leden beheren en chatten in de groep.
// Tabellen uit migratie 0008 (groups, group_members, messages.group_id). Foto's en video's van de groep
// staan in het album (photos.group_id, zie photos.ts).
// Een groep hoort bij je account, net als vrienden: niet bij één festival.
import type { Deps } from '../app.ts'
import { areFriends, audit, transaction, type Queryable } from '../db.ts'
import { badRequest, forbidden, notFound, requireUser, uuidParam, type Router } from '../http.ts'
import { MESSAGE_SELECT, saveMessage, saveSystemMessage } from '../messages.ts'
import { toMessage } from './mappers.ts'

/** Meer mensen in één groep wordt onoverzichtelijk in de app (en elke melding gaat naar iedereen) */
export const MAX_GROUP_MEMBERS = 100

type Role = 'beheerder' | 'lid'

interface Membership {
  role: Role
}

async function membership(db: Queryable, groupId: string, userId: string): Promise<Membership | null> {
  const { rows } = await db.query<Membership>('SELECT role FROM group_members WHERE group_id = $1 AND user_id = $2', [groupId, userId])
  return rows[0] ?? null
}

/** Lid van de groep? Anders 404: zo is niet na te gaan of een groep bestaat */
async function requireMember(db: Queryable, groupId: string, userId: string): Promise<Membership> {
  const member = await membership(db, groupId, userId)
  if (!member) throw notFound()
  return member
}

async function memberIds(db: Queryable, groupId: string): Promise<string[]> {
  const { rows } = await db.query<{ user_id: string }>('SELECT user_id FROM group_members WHERE group_id = $1', [groupId])
  return rows.map((r) => r.user_id)
}

async function nameOf(db: Queryable, userId: string): Promise<{ id: string; name: string }> {
  const { rows } = await db.query<{ display_name: string }>('SELECT display_name FROM users WHERE id = $1', [userId])
  return { id: userId, name: rows[0]?.display_name ?? '' }
}

/** Groep met leden, gezien vanuit `viewerId` */
async function groupDetail(db: Queryable, groupId: string, viewerId: string) {
  const { rows } = await db.query<{ id: string; name: string; description: string | null; created_by: string | null; created_at: Date }>(
    'SELECT id, name, description, created_by, created_at FROM groups WHERE id = $1',
    [groupId],
  )
  const group = rows[0]
  if (!group) throw notFound()
  const members = await db.query<{ id: string; display_name: string; role: Role; joined_at: Date }>(
    `SELECT u.id, u.display_name, gm.role, gm.joined_at
       FROM group_members gm JOIN users u ON u.id = gm.user_id
      WHERE gm.group_id = $1
      ORDER BY gm.role, lower(u.display_name)`,
    [groupId],
  )
  return {
    id: group.id,
    name: group.name,
    description: group.description,
    createdBy: group.created_by,
    createdAt: group.created_at.toISOString(),
    myRole: members.rows.find((m) => m.id === viewerId)?.role ?? 'lid',
    members: members.rows.map((m) => ({ id: m.id, displayName: m.display_name, role: m.role, joinedAt: m.joined_at.toISOString() })),
  }
}

/** Alleen vrienden van degene die toevoegt, zonder dubbele en zonder jezelf */
async function checkNewMembers(db: Queryable, actorId: string, userIds: string[]): Promise<string[]> {
  const unique = [...new Set(userIds)].filter((id) => id !== actorId)
  for (const id of unique) {
    // 404 en geen 403: zo kun je niet nagaan of iemand bestaat
    if (!(await areFriends(db, actorId, id))) throw notFound('Je kunt alleen vrienden toevoegen.')
  }
  return unique
}

export function groupRoutes(r: Router, deps: Deps): void {
  const { db } = deps

  /** Laat de leden weten dat er iets aan de groep veranderde (naam, leden); de app haalt hem dan opnieuw op */
  const announceUpdate = async (groupId: string, extra: string[] = []) => {
    deps.realtime.toUsers([...(await memberIds(db, groupId)), ...extra], 'group.updated', { groupId })
  }
  const sendToMembers = async (groupId: string, message: ReturnType<typeof toMessage>) => {
    deps.realtime.toUsers(await memberIds(db, groupId), 'group.message', message)
  }

  r.get('/groups', { operationId: 'listGroups' }, async (ctx) => {
    const user = requireUser(ctx)
    const { rows } = await db.query<{
      id: string
      name: string
      description: string | null
      role: Role
      member_count: number
      unread: number
      last_message_at: Date | null
      created_at: Date
    }>(
      `SELECT g.id, g.name, g.description, gm.role, g.created_at,
              (SELECT count(*)::int FROM group_members x WHERE x.group_id = g.id) AS member_count,
              (SELECT count(*)::int FROM messages m
                WHERE m.group_id = g.id AND m.created_at > gm.last_read_at AND m.sender_id <> $1 AND m.kind <> 'systeem') AS unread,
              (SELECT max(m.created_at) FROM messages m WHERE m.group_id = g.id) AS last_message_at
         FROM group_members gm JOIN groups g ON g.id = gm.group_id
        WHERE gm.user_id = $1
        ORDER BY coalesce((SELECT max(m.created_at) FROM messages m WHERE m.group_id = g.id), g.created_at) DESC
        LIMIT 200`,
      [user.id],
    )
    return {
      status: 200,
      body: rows.map((g) => ({
        id: g.id,
        name: g.name,
        description: g.description,
        myRole: g.role,
        memberCount: g.member_count,
        unread: g.unread,
        lastMessageAt: g.last_message_at?.toISOString() ?? null,
        createdAt: g.created_at.toISOString(),
      })),
    }
  })

  r.post('/groups', { operationId: 'createGroup', rateLimit: { limit: 10, windowMs: 60_000 } }, async (ctx) => {
    const user = requireUser(ctx)
    const body = ctx.body as { name: string; description?: string; memberIds: string[] }
    const name = body.name.trim()
    if (!name) throw badRequest('Geef de groep een naam.')
    const members = await checkNewMembers(db, user.id, body.memberIds)
    if (members.length === 0) throw badRequest('Kies minstens één vriend.')
    if (members.length + 1 > MAX_GROUP_MEMBERS) throw badRequest(`Een groep heeft maximaal ${MAX_GROUP_MEMBERS} leden.`)

    const groupId = await transaction(db, async (client) => {
      const { rows } = await client.query<{ id: string }>(
        'INSERT INTO groups (name, description, created_by) VALUES ($1, $2, $3) RETURNING id',
        [name, body.description?.trim() || null, user.id],
      )
      const id = rows[0]!.id
      await client.query(`INSERT INTO group_members (group_id, user_id, role, added_by) VALUES ($1, $2, 'beheerder', $2)`, [id, user.id])
      await client.query(
        `INSERT INTO group_members (group_id, user_id, added_by) SELECT $1, unnest($2::uuid[]), $3`,
        [id, members, user.id],
      )
      const actor = await nameOf(client, user.id)
      await saveSystemMessage(client, id, actor, { type: 'aangemaakt', value: name })
      await saveSystemMessage(client, id, actor, { type: 'toegevoegd', targets: await Promise.all(members.map((m) => nameOf(client, m))) })
      return id
    })
    await audit(db, user.id, 'group.create', { type: 'group', id: groupId }, { members: members.length + 1 })
    await announceUpdate(groupId)
    return { status: 201, body: await groupDetail(db, groupId, user.id) }
  })

  r.get('/groups/:groupId', { operationId: 'getGroup' }, async (ctx) => {
    const user = requireUser(ctx)
    const groupId = uuidParam(ctx, 'groupId')
    await requireMember(db, groupId, user.id)
    return { status: 200, body: await groupDetail(db, groupId, user.id) }
  })

  r.patch('/groups/:groupId', { operationId: 'updateGroup', rateLimit: { limit: 20, windowMs: 60_000 } }, async (ctx) => {
    const user = requireUser(ctx)
    const groupId = uuidParam(ctx, 'groupId')
    const member = await requireMember(db, groupId, user.id)
    if (member.role !== 'beheerder') throw forbidden('Alleen een beheerder kan de groep aanpassen.')
    const body = ctx.body as { name?: string; description?: string | null }
    const name = body.name?.trim()
    if (body.name !== undefined && !name) throw badRequest('Geef de groep een naam.')
    await db.query(
      `UPDATE groups SET name = coalesce($2, name),
              description = CASE WHEN $3::boolean THEN $4 ELSE description END
        WHERE id = $1`,
      [groupId, name ?? null, body.description !== undefined, body.description?.trim() || null],
    )
    if (name) {
      const message = await saveSystemMessage(db, groupId, await nameOf(db, user.id), { type: 'naam', value: name })
      await sendToMembers(groupId, message)
    }
    await announceUpdate(groupId)
    return { status: 200, body: await groupDetail(db, groupId, user.id) }
  })

  r.post('/groups/:groupId/members', { operationId: 'addGroupMembers', rateLimit: { limit: 20, windowMs: 60_000 } }, async (ctx) => {
    const user = requireUser(ctx)
    const groupId = uuidParam(ctx, 'groupId')
    const member = await requireMember(db, groupId, user.id)
    if (member.role !== 'beheerder') throw forbidden('Alleen een beheerder kan leden toevoegen.')
    const current = new Set(await memberIds(db, groupId))
    const added = (await checkNewMembers(db, user.id, (ctx.body as { userIds: string[] }).userIds)).filter((id) => !current.has(id))
    if (added.length === 0) return { status: 200, body: await groupDetail(db, groupId, user.id) }
    if (current.size + added.length > MAX_GROUP_MEMBERS) throw badRequest(`Een groep heeft maximaal ${MAX_GROUP_MEMBERS} leden.`)

    await db.query(`INSERT INTO group_members (group_id, user_id, added_by) SELECT $1, unnest($2::uuid[]), $3 ON CONFLICT DO NOTHING`, [
      groupId,
      added,
      user.id,
    ])
    const message = await saveSystemMessage(db, groupId, await nameOf(db, user.id), {
      type: 'toegevoegd',
      targets: await Promise.all(added.map((id) => nameOf(db, id))),
    })
    await sendToMembers(groupId, message)
    await announceUpdate(groupId)
    return { status: 200, body: await groupDetail(db, groupId, user.id) }
  })

  // Iemand weghalen (beheerder), of zelf de groep verlaten (je eigen id)
  r.delete('/groups/:groupId/members/:userId', { operationId: 'removeGroupMember' }, async (ctx) => {
    const user = requireUser(ctx)
    const groupId = uuidParam(ctx, 'groupId')
    const target = uuidParam(ctx, 'userId')
    const member = await requireMember(db, groupId, user.id)
    const leaving = target === user.id
    if (!leaving && member.role !== 'beheerder') throw forbidden('Alleen een beheerder kan leden verwijderen.')
    if (!leaving && !(await membership(db, groupId, target))) throw notFound()

    const targetName = await nameOf(db, target)
    const remaining = await transaction(db, async (client) => {
      await client.query('DELETE FROM group_members WHERE group_id = $1 AND user_id = $2', [groupId, target])
      const { rows } = await client.query<{ user_id: string; role: Role }>(
        'SELECT user_id, role FROM group_members WHERE group_id = $1 ORDER BY joined_at',
        [groupId],
      )
      if (rows.length === 0) {
        // Laatste lid weg: de groep (met berichten en album) hoeft niet te blijven bestaan
        await client.query('DELETE FROM groups WHERE id = $1', [groupId])
        return 0
      }
      // Geen beheerder meer over? Dan wordt wie het langst in de groep zit beheerder
      if (!rows.some((m) => m.role === 'beheerder')) {
        await client.query(`UPDATE group_members SET role = 'beheerder' WHERE group_id = $1 AND user_id = $2`, [groupId, rows[0]!.user_id])
      }
      return rows.length
    })

    deps.realtime.toUser(target, 'group.removed', { groupId })
    if (remaining > 0) {
      const message = await saveSystemMessage(
        db,
        groupId,
        leaving ? targetName : await nameOf(db, user.id),
        leaving ? { type: 'verlaten' } : { type: 'verwijderd', targets: [targetName] },
      )
      await sendToMembers(groupId, message)
      await announceUpdate(groupId)
    }
    return { status: 204 }
  })

  r.get('/groups/:groupId/messages', { operationId: 'listGroupMessages' }, async (ctx) => {
    const user = requireUser(ctx)
    const groupId = uuidParam(ctx, 'groupId')
    await requireMember(db, groupId, user.id)
    const limit = Math.min(Math.max(Number(ctx.query.get('limit') ?? 50) || 50, 1), 100)
    const before = ctx.query.get('before')
    if (before && Number.isNaN(Date.parse(before))) throw badRequest('Het veld "before" is ongeldig.')
    const { rows } = await db.query(
      `${MESSAGE_SELECT}
        WHERE m.group_id = $1 AND ($2::timestamptz IS NULL OR m.created_at < $2)
        ORDER BY m.created_at DESC
        LIMIT $3`,
      [groupId, before, limit],
    )
    // Gelezen tot nu (alleen bij de nieuwste berichten, niet bij verder terug scrollen)
    if (!before) await db.query('UPDATE group_members SET last_read_at = now() WHERE group_id = $1 AND user_id = $2', [groupId, user.id])
    return { status: 200, body: rows.map(toMessage) }
  })

  r.post('/groups/:groupId/messages', { operationId: 'sendGroupMessage', rateLimit: { limit: 30, windowMs: 60_000 } }, async (ctx) => {
    const user = requireUser(ctx)
    const groupId = uuidParam(ctx, 'groupId')
    await requireMember(db, groupId, user.id)
    const { body, photoId, clientId } = ctx.body as { body?: string; photoId?: string; clientId?: string }
    const { message, created } = await saveMessage(db, { senderId: user.id, conversation: { groupId }, body, photoId, clientId })
    if (!created) return { status: 200, body: message }

    await sendToMembers(groupId, message)
    await db.query('UPDATE group_members SET last_read_at = now() WHERE group_id = $1 AND user_id = $2', [groupId, user.id])

    // Pushmelding voor wie de app niet open heeft en de groep niet heeft gedempt. Geen inhoud in de melding.
    const { rows } = await db.query<{ user_id: string }>(
      'SELECT user_id FROM group_members WHERE group_id = $1 AND user_id <> $2 AND NOT muted',
      [groupId, user.id],
    )
    const offline = rows.map((r) => r.user_id).filter((id) => !deps.realtime.isOnline(id))
    if (offline.length > 0) {
      const info = await db.query<{ name: string; sender: string }>(
        'SELECT g.name, u.display_name AS sender FROM groups g, users u WHERE g.id = $1 AND u.id = $2',
        [groupId, user.id],
      )
      void deps.push.toUsers(
        offline,
        {
          title: info.rows[0]?.name ?? 'Groep',
          body: `${info.rows[0]?.sender ?? ''}: ${photoId ? 'stuurde een foto of video' : 'stuurde een bericht'}`,
          tag: `group-${groupId}`,
          url: `/?group=${groupId}`,
        },
        'chat',
      )
    }
    return { status: 201, body: message }
  })
}
