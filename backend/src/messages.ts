// Berichten opslaan en ophalen, voor een gesprek met één vriend én voor een groep (zelfde tabel, zie 0008).
// Een bericht heeft tekst, een foto of video (photo_id), of allebei (dan is de tekst het bijschrift).
import type { Queryable } from './db.ts'
import { badRequest, notFound } from './http.ts'
import { toMessage } from './routes/mappers.ts'

/** Bericht met het type van de foto of video erbij, zodat de app weet wat hij moet tonen */
export const MESSAGE_SELECT = `SELECT m.*, p.content_type AS media_type FROM messages m LEFT JOIN photos p ON p.id = m.photo_id`

export type Conversation = { recipientId: string; groupId?: undefined } | { groupId: string; recipientId?: undefined }

export interface NewMessage {
  senderId: string
  conversation: Conversation
  body?: string
  photoId?: string
  clientId?: string
}

/**
 * Slaat een bericht op. Met een `clientId` die al eerder binnenkwam (opnieuw verstuurd bij slecht bereik)
 * komt het bestaande bericht terug met `created: false`; dat mag dan niet nog een keer rondgestuurd worden.
 * Een foto moet al in het album van dit gesprek staan (eerst POST /photos).
 */
export async function saveMessage(db: Queryable, input: NewMessage) {
  const body = input.body?.trim() || null
  const photoId = input.photoId ?? null
  if (!body && !photoId) throw badRequest('Stuur tekst, een foto of een video.')

  if (photoId) {
    const { recipientId, groupId } = input.conversation
    const { rowCount } = groupId
      ? await db.query('SELECT 1 FROM photos WHERE id = $1 AND group_id = $2', [photoId, groupId])
      : await db.query(
          'SELECT 1 FROM photos WHERE id = $1 AND user_a = LEAST($2::uuid, $3::uuid) AND user_b = GREATEST($2::uuid, $3::uuid)',
          [photoId, input.senderId, recipientId],
        )
    // Een foto uit een ander gesprek kun je niet doorsturen: die hoort bij andere mensen
    if (!rowCount) throw notFound('Deze foto of video staat niet in dit gesprek.')
  }

  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO messages (sender_id, recipient_id, group_id, kind, body, photo_id, client_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (sender_id, client_id) WHERE client_id IS NOT NULL DO NOTHING
     RETURNING id`,
    [
      input.senderId,
      input.conversation.recipientId ?? null,
      input.conversation.groupId ?? null,
      photoId ? 'foto' : 'tekst',
      body,
      photoId,
      input.clientId ?? null,
    ],
  )
  const created = rows.length > 0
  const { rows: saved } = created
    ? await db.query(`${MESSAGE_SELECT} WHERE m.id = $1`, [rows[0]!.id])
    : await db.query(`${MESSAGE_SELECT} WHERE m.sender_id = $1 AND m.client_id = $2`, [input.senderId, input.clientId])
  if (!saved[0]) throw notFound()
  return { message: toMessage(saved[0]), created }
}

/** Systeemregel in een groep ("Anna heeft Bram toegevoegd"). De app maakt er zelf een zin van. */
export async function saveSystemMessage(
  db: Queryable,
  groupId: string,
  actor: { id: string; name: string },
  event: { type: 'aangemaakt' | 'toegevoegd' | 'verwijderd' | 'verlaten' | 'naam'; targets?: { id: string; name: string }[]; value?: string },
) {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO messages (sender_id, group_id, kind, system_event) VALUES ($1, $2, 'systeem', $3) RETURNING id`,
    [actor.id, groupId, JSON.stringify({ type: event.type, actor, targets: event.targets ?? [], value: event.value ?? null })],
  )
  const { rows: saved } = await db.query(`${MESSAGE_SELECT} WHERE m.id = $1`, [rows[0]!.id])
  return toMessage(saved[0]!)
}
