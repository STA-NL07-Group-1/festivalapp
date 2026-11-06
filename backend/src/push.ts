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

export interface Push {
  enabled: boolean
  publicKey: string | null
  toUsers(userIds: string[], message: PushMessage): Promise<void>
  toEveryone(message: PushMessage): Promise<void>
}

export function createPush(db: Db, vapid: { publicKey: string; privateKey: string; subject: string } | null): Push {
  if (!vapid) {
    return { enabled: false, publicKey: null, toUsers: async () => {}, toEveryone: async () => {} }
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
    async toUsers(userIds, message) {
      if (userIds.length === 0) return
      const { rows } = await db.query('SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ANY($1)', [userIds])
      await sendAll(rows, message)
    },
    async toEveryone(message) {
      const { rows } = await db.query('SELECT id, endpoint, p256dh, auth FROM push_subscriptions')
      await sendAll(rows, message)
    },
  }
}
