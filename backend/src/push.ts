// Web Push via VAPID. Zonder VAPID-sleutels doet push niets (handig lokaal).
import webpush from 'web-push'
import type { Db } from './db.ts'

export interface PushMessage {
  title: string
  body: string
  /** Meldingen met dezelfde tag vervangen elkaar */
  tag?: string
  /** Pad in de app dat opent bij een tik */
  url?: string
  urgent?: boolean
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

/** Push-abonnementen van deze gebruikers, zonder wie deze soort melding heeft uitgezet */
export async function pushSubscriptionsFor(db: Db, userIds: string[], kind?: PushKind, urgent = false) {
  const preference = kind && !urgent ? `AND u.${PREFERENCE_COLUMN[kind]}` : ''
  const { rows } = await db.query<{ id: string; endpoint: string; p256dh: string; auth: string }>(
    `SELECT ps.id, ps.endpoint, ps.p256dh, ps.auth
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

  async function sendAll(rows: { id: string; endpoint: string; p256dh: string; auth: string }[], message: PushMessage) {
    const payload = JSON.stringify(message)
    await Promise.allSettled(
      rows.map(async (row) => {
        try {
          await webpush.sendNotification(
            { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } },
            payload,
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
