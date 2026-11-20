// Foto's en video's delen: in het album van een groep of van twee vrienden. Ze staan als bytea in de database
// (migratie 0008, video sinds 0011). Alleen leden van de groep, of de twee vrienden zelf, zien ze.
// Een chatbericht met een foto of video verwijst hiernaar (messages.photo_id).
import type { Deps } from '../app.ts'
import { areFriends } from '../db.ts'
import { badRequest, forbidden, notFound, requireUser, uuidParam, type Router } from '../http.ts'
import { imageType } from './content.ts'

/** 25 MB per bestand: de grens uit de database (photos_size in 0008) */
export const MAX_PHOTO_BYTES = 25 * 1024 * 1024
/** Base64 is een derde groter, plus een beetje JSON eromheen */
const MAX_UPLOAD_BODY = Math.ceil((MAX_PHOTO_BYTES * 4) / 3) + 10_000

type MediaType = 'image/png' | 'image/jpeg' | 'image/webp' | 'video/mp4' | 'video/quicktime' | 'video/webm'

/**
 * Herkent het bestand aan de eerste bytes, niet aan wat de app opgeeft. Foto: png, jpeg, webp.
 * Video: mp4 en mov (iPhone) herken je aan "ftyp" op plek 4, webm aan de EBML-kop.
 * HEIC-foto's hebben ook "ftyp", maar die weigeren we: de meeste browsers kunnen ze niet tonen
 * (een iPhone zet een foto bij het uploaden zelf om naar jpeg).
 */
export function mediaType(data: Buffer): MediaType | null {
  const image = imageType(data)
  if (image) return image
  if (data.length >= 4 && data[0] === 0x1a && data[1] === 0x45 && data[2] === 0xdf && data[3] === 0xa3) return 'video/webm'
  if (data.length >= 12 && data.toString('ascii', 4, 8) === 'ftyp') {
    const brand = data.toString('ascii', 8, 12)
    if (brand === 'qt  ') return 'video/quicktime'
    if (['heic', 'heix', 'hevc', 'hevx', 'mif1', 'msf1', 'avif'].includes(brand)) return null
    return 'video/mp4'
  }
  return null
}

type PhotoRow = {
  id: string
  uploaded_by: string
  group_id: string | null
  user_a: string | null
  user_b: string | null
  content_type: string
  caption: string | null
  created_at: Date
}

const PHOTO_COLUMNS = 'id, uploaded_by, group_id, user_a, user_b, content_type, caption, created_at'

/** Foto zonder de bytes zelf; die haal je op met GET /photos/{photoId} */
export function toPhoto(row: PhotoRow, viewerId: string) {
  return {
    id: row.id,
    uploadedBy: row.uploaded_by,
    groupId: row.group_id,
    // Bij een album van twee vrienden: de ander (vanuit degene die kijkt)
    friendId: row.user_a === null ? null : row.user_a === viewerId ? row.user_b : row.user_a,
    contentType: row.content_type,
    caption: row.caption,
    createdAt: row.created_at.toISOString(),
  }
}

/**
 * Haalt metagegevens uit een jpeg: APP1 (Exif met o.a. GPS-locatie, en XMP) en APP13 (IPTC).
 * Foto's van een telefoon bevatten vaak de plek waar ze zijn genomen; dat willen we niet bewaren of delen.
 * De app verkleint de foto vóór het uploaden (canvas), waarbij de stand al goed is gezet.
 * Geeft de bytes ongewijzigd terug als het bestand geen geldige jpeg-structuur heeft.
 */
export function stripJpegMetadata(data: Buffer): Buffer {
  if (data.length < 4 || data[0] !== 0xff || data[1] !== 0xd8) return data
  const parts: Buffer[] = [data.subarray(0, 2)]
  let i = 2
  while (i + 4 <= data.length) {
    if (data[i] !== 0xff) return data
    const marker = data[i + 1]!
    if (marker === 0xff) { i++; continue } // opvulbyte
    // Markers zonder lengte, of het begin van de beelddata (SOS): de rest ongewijzigd overnemen
    if (marker === 0xda || marker === 0xd9) {
      parts.push(data.subarray(i))
      return Buffer.concat(parts)
    }
    const length = data.readUInt16BE(i + 2)
    if (length < 2 || i + 2 + length > data.length) return data
    const segment = data.subarray(i, i + 2 + length)
    if (marker !== 0xe1 && marker !== 0xed) parts.push(segment)
    i += 2 + length
  }
  return data
}

export function photoRoutes(r: Router, deps: Deps): void {
  const { db } = deps

  /** Mag deze gebruiker bij de foto? Groep: lid. Twee vrienden: een van de twee, en nog steeds vrienden. */
  async function canSee(userId: string, row: Pick<PhotoRow, 'group_id' | 'user_a' | 'user_b'>): Promise<boolean> {
    if (row.group_id) {
      const { rowCount } = await db.query('SELECT 1 FROM group_members WHERE group_id = $1 AND user_id = $2', [row.group_id, userId])
      return (rowCount ?? 0) > 0
    }
    if (row.user_a !== userId && row.user_b !== userId) return false
    return areFriends(db, row.user_a!, row.user_b!)
  }

  r.post('/photos', { operationId: 'uploadPhoto', maxBodyBytes: MAX_UPLOAD_BODY, rateLimit: { limit: 20, windowMs: 60_000 } }, async (ctx) => {
    const user = requireUser(ctx)
    const b = ctx.body as { image: string; caption?: string; friendId?: string; groupId?: string }
    if ((b.friendId === undefined) === (b.groupId === undefined)) throw badRequest('Geef precies één van "friendId" of "groupId" op.')

    const raw = Buffer.from(b.image, 'base64')
    if (raw.length === 0 || raw.length > MAX_PHOTO_BYTES) throw badRequest('Het bestand mag maximaal 25 MB zijn.')
    const type = mediaType(raw)
    if (!type) throw badRequest('Alleen een foto (png, jpeg of webp) of een video (mp4, mov of webm).')
    const data = type === 'image/jpeg' ? stripJpegMetadata(raw) : raw
    const caption = b.caption?.trim() || null

    let groupId: string | null = null
    let userA: string | null = null
    let userB: string | null = null
    if (b.groupId) {
      const { rowCount } = await db.query('SELECT 1 FROM group_members WHERE group_id = $1 AND user_id = $2', [b.groupId, user.id])
      if (!rowCount) throw notFound()
      groupId = b.groupId
    } else {
      // 404 en geen 403: zo kun je niet nagaan of iemand bestaat
      if (!(await areFriends(db, user.id, b.friendId!))) throw notFound()
      ;[userA, userB] = user.id < b.friendId! ? [user.id, b.friendId!] : [b.friendId!, user.id]
    }

    const { rows } = await db.query<PhotoRow>(
      `INSERT INTO photos (uploaded_by, group_id, user_a, user_b, content_type, data, caption)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING ${PHOTO_COLUMNS}`,
      [user.id, groupId, userA, userB, type, data, caption],
    )
    return { status: 201, body: toPhoto(rows[0]!, user.id) }
  })

  r.get('/photos', { operationId: 'listPhotos' }, async (ctx) => {
    const user = requireUser(ctx)
    const friendId = ctx.query.get('friendId')
    const groupId = ctx.query.get('groupId')
    if ((friendId === null) === (groupId === null)) throw badRequest('Geef precies één van "friendId" of "groupId" op.')
    const limit = Math.min(Math.max(Number(ctx.query.get('limit') ?? 50) || 50, 1), 100)
    const before = ctx.query.get('before')
    if (before && Number.isNaN(Date.parse(before))) throw badRequest('Het veld "before" is ongeldig.')

    let where: string
    let params: unknown[]
    if (groupId) {
      if (!(await canSee(user.id, { group_id: groupId, user_a: null, user_b: null }))) throw notFound()
      where = 'group_id = $1'
      params = [groupId]
    } else {
      if (!(await areFriends(db, user.id, friendId!))) throw notFound()
      const [a, b] = user.id < friendId! ? [user.id, friendId!] : [friendId!, user.id]
      where = 'user_a = $1 AND user_b = $2'
      params = [a, b]
    }
    const n = params.length
    const { rows } = await db.query<PhotoRow>(
      `SELECT ${PHOTO_COLUMNS} FROM photos
        WHERE ${where} AND ($${n + 1}::timestamptz IS NULL OR created_at < $${n + 1})
        ORDER BY created_at DESC LIMIT $${n + 2}`,
      [...params, before, limit],
    )
    return { status: 200, body: rows.map((row) => toPhoto(row, user.id)) }
  })

  r.get('/photos/:photoId', { operationId: 'getPhoto' }, async (ctx) => {
    const user = requireUser(ctx)
    const { rows } = await db.query<PhotoRow & { data: Buffer }>(
      `SELECT ${PHOTO_COLUMNS}, data FROM photos WHERE id = $1`,
      [uuidParam(ctx, 'photoId')],
    )
    const photo = rows[0]
    if (!photo || !(await canSee(user.id, photo))) throw notFound()
    return {
      status: 200,
      body: photo.data,
      headers: {
        'Content-Type': photo.content_type,
        // Een foto is privé: niet delen via een cache van een ander
        'Cache-Control': 'private, max-age=3600',
        'Content-Security-Policy': "default-src 'none'",
        'X-Content-Type-Options': 'nosniff',
      },
    }
  })

  r.delete('/photos/:photoId', { operationId: 'deletePhoto' }, async (ctx) => {
    const user = requireUser(ctx)
    const id = uuidParam(ctx, 'photoId')
    const { rows } = await db.query<PhotoRow>(`SELECT ${PHOTO_COLUMNS} FROM photos WHERE id = $1`, [id])
    const photo = rows[0]
    if (!photo || !(await canSee(user.id, photo))) throw notFound()
    if (photo.uploaded_by !== user.id) {
      // In een groep mag ook een beheerder een foto weghalen
      const admin = photo.group_id
        ? await db.query("SELECT 1 FROM group_members WHERE group_id = $1 AND user_id = $2 AND role = 'beheerder'", [photo.group_id, user.id])
        : null
      if (!admin?.rowCount) throw forbidden('Je kunt alleen je eigen foto weghalen.')
    }
    // Berichten met deze foto blijven staan; hun photo_id wordt vanzelf leeg (ON DELETE SET NULL)
    await db.query('DELETE FROM photos WHERE id = $1', [id])
    return { status: 204 }
  })
}
