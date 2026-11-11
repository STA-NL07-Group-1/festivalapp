// Bij welk festival hoort dit verzoek, en welke rol heeft de gebruiker daar?
// Dit wordt bij elk ingelogd verzoek opnieuw uit de database gehaald, zodat een nieuwe
// rol, een blokkade of een afgelopen festival meteen werkt (en niet pas na 15 minuten).
import type { Queryable } from './db.ts'
import { forbidden, type FestivalRole, type PlatformRole, type Role } from './http.ts'

export interface FestivalAccess {
  id: string
  name: string
  startsAt: Date
  endsAt: Date
  role: Role
  /** Soort ticket (weekend, dag, vip); null als je geen ticket hebt, bijv. als personeel */
  ticketType: string | null
}

export interface UserAccess {
  platformRole: PlatformRole | null
  /** Geblokkeerd voor alle festivals */
  blocked: boolean
  /** Festivals waar deze gebruiker nu bij mag, het meest logische eerst */
  festivals: FestivalAccess[]
}

interface AccessRow {
  platform_role: PlatformRole | null
  blocked_at: Date | null
  id: string | null
  name: string
  starts_at: Date
  ends_at: Date
  member_role: FestivalRole | null
  has_ticket: boolean
  ticket_type: string | null
  festival_blocked: boolean
}

/** Geeft null als het account niet (meer) bestaat. */
export async function loadAccess(db: Queryable, userId: string): Promise<UserAccess | null> {
  const { rows } = await db.query<AccessRow>(
    `SELECT u.platform_role, u.blocked_at, f.id, f.name, f.starts_at, f.ends_at,
            m.role AS member_role,
            EXISTS (SELECT 1 FROM tickets t WHERE t.festival_id = f.id AND t.user_id = u.id AND t.status = 'gekoppeld') AS has_ticket,
            (SELECT t.ticket_type FROM tickets t WHERE t.festival_id = f.id AND t.user_id = u.id AND t.status = 'gekoppeld') AS ticket_type,
            EXISTS (SELECT 1 FROM festival_blocks b WHERE b.festival_id = f.id AND b.user_id = u.id) AS festival_blocked
       FROM users u
       LEFT JOIN festivals f ON true
       LEFT JOIN festival_members m ON m.festival_id = f.id AND m.user_id = u.id
      WHERE u.id = $1`,
    [userId],
  )
  const first = rows[0]
  if (!first) return null
  const now = Date.now()
  const festivals: FestivalAccess[] = []
  for (const row of rows) {
    if (!row.id) continue
    let role: Role | null = null
    // Eigenaren en sudo mogen bij elk festival, met de rechten van een beheerder
    if (first.platform_role) role = 'beheerder'
    else if (row.member_role) role = row.member_role
    // Bezoekers: alleen met een ticket, niet geblokkeerd, en tot het festival is afgelopen
    else if (row.has_ticket && !row.festival_blocked && row.ends_at.getTime() > now) role = 'bezoeker'
    if (role) festivals.push({ id: row.id, name: row.name, startsAt: row.starts_at, endsAt: row.ends_at, role, ticketType: row.ticket_type })
  }
  // Volgorde: festivals die nu bezig zijn, dan de eerstvolgende, dan afgelopen festivals (alleen voor personeel)
  const rank = (f: FestivalAccess) => (f.endsAt.getTime() <= now ? 2 : f.startsAt.getTime() <= now ? 0 : 1)
  festivals.sort((a, b) => rank(a) - rank(b) || a.startsAt.getTime() - b.startsAt.getTime() || a.id.localeCompare(b.id))
  return { platformRole: first.platform_role, blocked: first.blocked_at !== null, festivals }
}

/**
 * Kiest het festival voor dit verzoek. Met de header X-Festival-Id kiest de client zelf;
 * zonder header nemen we het meest logische festival (zo blijven oudere versies van de app werken).
 */
export function pickFestival(access: UserAccess, requested: string | null): FestivalAccess | null {
  if (!requested) return access.festivals[0] ?? null
  const festival = access.festivals.find((f) => f.id === requested)
  if (!festival) throw forbidden('Je hebt geen toegang tot dit festival.')
  return festival
}

/** Festival en rol voor een WebSocket-verbinding (zie realtime.ts). */
export async function resolveSocket(db: Queryable, userId: string, requested: string | null): Promise<{ festivalId: string | null; role: Role } | null> {
  const access = await loadAccess(db, userId)
  if (!access || access.blocked) return null
  const festival = requested ? access.festivals.find((f) => f.id === requested) : access.festivals[0]
  if (requested && !festival) return null
  return { festivalId: festival?.id ?? null, role: festival?.role ?? 'bezoeker' }
}

/** Iedereen die bij een festival hoort: bezoekers met een ticket en het personeel. Voor pushmeldingen. */
export async function festivalUserIds(db: Queryable, festivalId: string): Promise<string[]> {
  const { rows } = await db.query<{ user_id: string }>(
    `SELECT user_id FROM tickets WHERE festival_id = $1 AND status = 'gekoppeld' AND user_id IS NOT NULL
     UNION
     SELECT user_id FROM festival_members WHERE festival_id = $1`,
    [festivalId],
  )
  return rows.map((r) => r.user_id)
}

/** Wie mag welke rol uitdelen? Beheerder: alleen sudo. Organisatie: beheerders. EHBO en beveiliging: ook de organisatie. */
export function canAssign(actor: { role: Role; platformRole: PlatformRole | null }, target: FestivalRole): boolean {
  if (target === 'beheerder') return actor.platformRole === 'sudo'
  if (target === 'organisatie') return actor.role === 'beheerder'
  return actor.role === 'beheerder' || actor.role === 'organisatie'
}
