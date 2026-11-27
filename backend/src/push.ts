// Web Push via VAPID. Zonder VAPID-sleutels doet push niets (handig lokaal).
// Elke melding gaat in de taal waarin de app van de ontvanger staat (users.locale).
import webpush from 'web-push'
import type { Db } from './db.ts'
import type { Locale } from './translate.ts'

/** Eén tekst voor iedereen (bijv. een naam), of een tekst per taal */
export type PushText = string | Record<Locale, string>

export interface PushMessage {
  title: PushText
  body: PushText
  /** Meldingen met dezelfde tag vervangen elkaar */
  tag?: string
  /** Pad in de app dat opent bij een tik */
  url?: string
  urgent?: boolean
  /** Chatbericht: het aantal ongelezen berichten meesturen, voor het getal op het app-icoon */
  withUnread?: boolean
}

/** De tekst in de taal van de ontvanger */
export const inLocale = (text: PushText, locale: Locale): string => (typeof text === 'string' ? text : text[locale])

/** Wat er echt naar de telefoon gaat (zie app/src/sw.ts) */
export function pushPayload(message: PushMessage, locale: Locale, unread?: number): string {
  return JSON.stringify({
    title: inLocale(message.title, locale),
    body: inLocale(message.body, locale),
    tag: message.tag,
    url: message.url,
    urgent: message.urgent,
    unread,
  })
}

/**
 * Ongelezen chatberichten per gebruiker: van vrienden en uit groepen. Gedempte gesprekken tellen ook mee,
 * net als bij WhatsApp: dempen haalt alleen de melding weg, niet het getal.
 */
export async function unreadCounts(db: Pick<Db, 'query'>, userIds: string[]): Promise<Map<string, number>> {
  const { rows } = await db.query<{ id: string; total: number }>(
    `SELECT u.id,
            (SELECT count(*)::int FROM messages m
              WHERE m.recipient_id = u.id AND m.read_at IS NULL
                AND EXISTS (SELECT 1 FROM friendships f
                             WHERE (f.user_a = u.id AND f.user_b = m.sender_id) OR (f.user_b = u.id AND f.user_a = m.sender_id)))
          + (SELECT count(*)::int FROM group_members gm JOIN messages m ON m.group_id = gm.group_id
              WHERE gm.user_id = u.id AND m.created_at > gm.last_read_at AND m.sender_id <> u.id AND m.kind <> 'systeem') AS total
       FROM users u WHERE u.id = ANY($1)`,
    [userIds],
  )
  return new Map(rows.map((r) => [r.id, r.total]))
}

/** Soort melding; iedereen kan elke soort in Instellingen uitzetten (users.notify_*) */
export type PushKind = 'chat' | 'timetable' | 'announcement'

export interface Push {
  enabled: boolean
  publicKey: string | null
  /** Met `kind` krijgen alleen mensen die die soort aan hebben de melding. Een urgente melding (nood) gaat altijd door. */
  toUsers(userIds: string[], message: PushMessage, kind?: PushKind): Promise<void>
}

// Vaste kolomnamen: nooit iets van buiten in de query
const PREFERENCE_COLUMN: Record<PushKind, string> = {
  chat: 'notify_chat',
  timetable: 'notify_timetable',
  announcement: 'notify_announcements',
}

interface Subscription {
  id: string
  user_id: string
  endpoint: string
  p256dh: string
  auth: string
  locale: Locale
}

/** Push-abonnementen van deze gebruikers, zonder wie deze soort melding heeft uitgezet */
export async function pushSubscriptionsFor(db: Db, userIds: string[], kind?: PushKind, urgent = false) {
  const preference = kind && !urgent ? `AND u.${PREFERENCE_COLUMN[kind]}` : ''
  const { rows } = await db.query<Subscription>(
    `SELECT ps.id, ps.user_id, ps.endpoint, ps.p256dh, ps.auth, u.locale
       FROM push_subscriptions ps JOIN users u ON u.id = ps.user_id
      WHERE ps.user_id = ANY($1) ${preference}`,
    [userIds],
  )
  return rows
}

export function createPush(db: Db, vapid: { publicKey: string; privateKey: string; subject: string } | null): Push {
  if (!vapid) {
    return { enabled: false, publicKey: null, toUsers: async () => {} }
  }
  webpush.setVapidDetails(vapid.subject, vapid.publicKey, vapid.privateKey)

  async function sendAll(rows: Subscription[], message: PushMessage) {
    const unread = message.withUnread && rows.length > 0 ? await unreadCounts(db, [...new Set(rows.map((r) => r.user_id))]) : null
    await Promise.allSettled(
      rows.map(async (row) => {
        try {
          await webpush.sendNotification(
            { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } },
            pushPayload(message, row.locale, unread?.get(row.user_id)),
            { TTL: message.urgent ? 3600 : 600, urgency: message.urgent ? 'high' : 'normal' },
          )
        } catch (error) {
          const status = (error as { statusCode?: number }).statusCode
          // Abonnement bestaat niet meer: opruimen
          if (status === 404 || status === 410) await db.query('DELETE FROM push_subscriptions WHERE id = $1', [row.id])
        }
      }),
    )
  }

  return {
    enabled: true,
    publicKey: vapid.publicKey,
    async toUsers(userIds, message, kind) {
      if (userIds.length === 0) return
      await sendAll(await pushSubscriptionsFor(db, userIds, kind, message.urgent), message)
    },
  }
}
