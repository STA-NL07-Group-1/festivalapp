// Informatie per festival: huisregels, veelgestelde vragen, plattegrond en gevonden voorwerpen.
// Bezoekers lezen; de organisatie (beheerder en organisatie) past aan in het portal.
import type { Deps } from '../app.ts'
import { audit } from '../db.ts'
import { ORGANISERS, STAFF, badRequest, notFound, requireFestival, requireUser, uuidParam, type Router } from '../http.ts'
import { FAQ_COLUMNS, LOST_ITEM_COLUMNS, toFaqItem, toLostItem } from './mappers.ts'

const MAX_IMAGE_BYTES = 3 * 1024 * 1024

/** Herkent png, jpeg en webp aan de eerste bytes; vertrouwt dus niet op wat de browser zegt */
export function imageType(data: Buffer): 'image/png' | 'image/jpeg' | 'image/webp' | null {
  if (data.length >= 8 && data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png'
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return 'image/jpeg'
  if (data.length >= 12 && data.toString('ascii', 0, 4) === 'RIFF' && data.toString('ascii', 8, 12) === 'WEBP') return 'image/webp'
  return null
}

type FaqInput = { questionNl: string; questionEn: string; answerNl: string; answerEn: string; sortOrder?: number }

export function contentRoutes(r: Router, deps: Deps): void {
  const { db } = deps

  // ------------------------------------------------------------- overzicht
  // Alles in één verzoek, zodat de app het in één keer offline kan bewaren
  r.get('/festival-info', { operationId: 'getFestivalInfo' }, async (ctx) => {
    const festivalId = requireFestival(ctx)
    const festival = await db.query<{ house_rules_nl: string | null; house_rules_en: string | null; map_updated_at: Date | null }>(
      `SELECT f.house_rules_nl, f.house_rules_en, m.updated_at AS map_updated_at
         FROM festivals f LEFT JOIN site_maps m ON m.festival_id = f.id
        WHERE f.id = $1`,
      [festivalId],
    )
    const faq = await db.query(`SELECT ${FAQ_COLUMNS} FROM faq_items WHERE festival_id = $1 ORDER BY sort_order, created_at LIMIT 200`, [festivalId])
    const row = festival.rows[0]
    if (!row) throw notFound()
    return {
      status: 200,
      body: {
        houseRulesNl: row.house_rules_nl,
        houseRulesEn: row.house_rules_en,
        // De app vergelijkt dit tijdstip met de bewaarde plattegrond, zodat hij alleen een nieuwe ophaalt als die er is
        siteMapUpdatedAt: row.map_updated_at?.toISOString() ?? null,
        faq: faq.rows.map(toFaqItem),
      },
    }
  })

  // ------------------------------------------------------------- huisregels
  r.put('/admin/house-rules', { operationId: 'updateHouseRules', roles: ORGANISERS }, async (ctx) => {
    const user = requireUser(ctx)
    const festivalId = requireFestival(ctx)
    const b = ctx.body as { houseRulesNl: string; houseRulesEn: string }
    await db.query('UPDATE festivals SET house_rules_nl = $2, house_rules_en = $3 WHERE id = $1', [
      festivalId,
      b.houseRulesNl.trim() || null,
      b.houseRulesEn.trim() || null,
    ])
    await audit(db, user.id, 'festival.house_rules', { type: 'festival', id: festivalId })
    return { status: 204 }
  })

  // ------------------------------------------------------------- veelgestelde vragen
  r.post('/admin/faq', { operationId: 'createFaqItem', roles: ORGANISERS }, async (ctx) => {
    const user = requireUser(ctx)
    const festivalId = requireFestival(ctx)
    const b = ctx.body as FaqInput
    const { rows } = await db.query(
      `INSERT INTO faq_items (festival_id, question_nl, question_en, answer_nl, answer_en, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING ${FAQ_COLUMNS}`,
      [festivalId, b.questionNl.trim(), b.questionEn.trim(), b.answerNl.trim(), b.answerEn.trim(), b.sortOrder ?? 0],
    ).catch((error: { code?: string }) => {
      // 23514 = CHECK: na het weghalen van spaties is een veld leeg
      if (error.code === '23514') throw badRequest('Vul de vraag en het antwoord in beide talen in.')
      throw error
    })
    const item = toFaqItem(rows[0]!)
    await audit(db, user.id, 'faq.create', { type: 'faq_item', id: String(item.id) })
    return { status: 201, body: item }
  })

  r.patch('/admin/faq/:faqId', { operationId: 'updateFaqItem', roles: ORGANISERS }, async (ctx) => {
    const user = requireUser(ctx)
    const festivalId = requireFestival(ctx)
    const id = uuidParam(ctx, 'faqId')
    const b = ctx.body as Partial<FaqInput>
    const { rows } = await db.query(
      `UPDATE faq_items SET
          question_nl = coalesce($3, question_nl),
          question_en = coalesce($4, question_en),
          answer_nl   = coalesce($5, answer_nl),
          answer_en   = coalesce($6, answer_en),
          sort_order  = coalesce($7, sort_order)
        WHERE id = $1 AND festival_id = $2 RETURNING ${FAQ_COLUMNS}`,
      [id, festivalId, b.questionNl?.trim() ?? null, b.questionEn?.trim() ?? null, b.answerNl?.trim() ?? null, b.answerEn?.trim() ?? null, b.sortOrder ?? null],
    ).catch((error: { code?: string }) => {
      if (error.code === '23514') throw badRequest('Vul de vraag en het antwoord in beide talen in.')
      throw error
    })
    if (!rows[0]) throw notFound()
    await audit(db, user.id, 'faq.update', { type: 'faq_item', id })
    return { status: 200, body: toFaqItem(rows[0]) }
  })

  r.delete('/admin/faq/:faqId', { operationId: 'deleteFaqItem', roles: ORGANISERS }, async (ctx) => {
    const user = requireUser(ctx)
    const id = uuidParam(ctx, 'faqId')
    const { rowCount } = await db.query('DELETE FROM faq_items WHERE id = $1 AND festival_id = $2', [id, requireFestival(ctx)])
    if (!rowCount) throw notFound()
    await audit(db, user.id, 'faq.delete', { type: 'faq_item', id })
    return { status: 204 }
  })

  // ------------------------------------------------------------- plattegrond
  r.get('/site-map', { operationId: 'getSiteMap' }, async (ctx) => {
    const { rows } = await db.query<{ content_type: string; data: Buffer; updated_at: Date }>(
      'SELECT content_type, data, updated_at FROM site_maps WHERE festival_id = $1',
      [requireFestival(ctx)],
    )
    const map = rows[0]
    if (!map) throw notFound('Dit festival heeft nog geen plattegrond.')
    return {
      status: 200,
      body: map.data,
      headers: {
        'Content-Type': map.content_type,
        'Last-Modified': map.updated_at.toUTCString(),
        // Een afbeelding mag nooit als pagina of script worden uitgevoerd
        'Content-Security-Policy': "default-src 'none'",
      },
    }
  })

  // Base64 in JSON, zodat alles via dezelfde (gevalideerde) weg loopt. 3 MB wordt ongeveer 4 MB base64.
  r.put('/admin/site-map', { operationId: 'uploadSiteMap', roles: ORGANISERS, maxBodyBytes: 4_500_000, rateLimit: { limit: 10, windowMs: 60_000 } }, async (ctx) => {
    const user = requireUser(ctx)
    const festivalId = requireFestival(ctx)
    const { image } = ctx.body as { image: string }
    const data = Buffer.from(image, 'base64')
    if (data.length === 0 || data.length > MAX_IMAGE_BYTES) throw badRequest('De afbeelding mag maximaal 3 MB zijn.')
    const type = imageType(data)
    if (!type) throw badRequest('Alleen png, jpeg of webp.')
    const { rows } = await db.query<{ updated_at: Date }>(
      `INSERT INTO site_maps (festival_id, content_type, data, updated_by) VALUES ($1, $2, $3, $4)
       ON CONFLICT (festival_id) DO UPDATE SET content_type = EXCLUDED.content_type, data = EXCLUDED.data,
         updated_by = EXCLUDED.updated_by, updated_at = now()
       RETURNING updated_at`,
      [festivalId, type, data, user.id],
    )
    await audit(db, user.id, 'festival.site_map', { type: 'festival', id: festivalId }, { bytes: data.length })
    return { status: 200, body: { siteMapUpdatedAt: rows[0]!.updated_at.toISOString() } }
  })

  r.delete('/admin/site-map', { operationId: 'deleteSiteMap', roles: ORGANISERS }, async (ctx) => {
    const user = requireUser(ctx)
    const festivalId = requireFestival(ctx)
    const { rowCount } = await db.query('DELETE FROM site_maps WHERE festival_id = $1', [festivalId])
    if (!rowCount) throw notFound()
    await audit(db, user.id, 'festival.site_map_delete', { type: 'festival', id: festivalId })
    return { status: 204 }
  })

  // ------------------------------------------------------------- gevonden voorwerpen
  // Bezoekers zien wat nog niet is opgehaald, van de afgelopen 30 dagen
  r.get('/lost-items', { operationId: 'listLostItems' }, async (ctx) => {
    const { rows } = await db.query(
      `SELECT ${LOST_ITEM_COLUMNS} FROM lost_items
        WHERE festival_id = $1 AND status = 'gevonden' AND found_at > now() - interval '30 days'
        ORDER BY found_at DESC LIMIT 200`,
      [requireFestival(ctx)],
    )
    return { status: 200, body: rows.map(toLostItem) }
  })

  // Personeel ziet alles, ook wat al is opgehaald. EHBO en beveiliging vinden ook dingen.
  r.get('/admin/lost-items', { operationId: 'listAllLostItems', roles: STAFF }, async (ctx) => {
    const { rows } = await db.query(
      `SELECT ${LOST_ITEM_COLUMNS} FROM lost_items WHERE festival_id = $1 ORDER BY (status = 'opgehaald'), found_at DESC LIMIT 500`,
      [requireFestival(ctx)],
    )
    return { status: 200, body: rows.map(toLostItem) }
  })

  r.post('/admin/lost-items', { operationId: 'createLostItem', roles: STAFF }, async (ctx) => {
    const user = requireUser(ctx)
    const b = ctx.body as { description: string; foundWhere?: string }
    if (!b.description.trim()) throw badRequest('Omschrijf het voorwerp.')
    const { rows } = await db.query(
      `INSERT INTO lost_items (festival_id, description, found_where, created_by) VALUES ($1, $2, $3, $4)
       RETURNING ${LOST_ITEM_COLUMNS}`,
      [requireFestival(ctx), b.description.trim(), b.foundWhere?.trim() || null, user.id],
    )
    const item = toLostItem(rows[0]!)
    await audit(db, user.id, 'lost_item.create', { type: 'lost_item', id: String(item.id) })
    return { status: 201, body: item }
  })

  r.patch('/admin/lost-items/:lostItemId', { operationId: 'updateLostItem', roles: STAFF }, async (ctx) => {
    const user = requireUser(ctx)
    const id = uuidParam(ctx, 'lostItemId')
    const { status } = ctx.body as { status: 'gevonden' | 'opgehaald' }
    const { rows } = await db.query(
      `UPDATE lost_items
          SET status = $3::lost_item_status,
              collected_at = CASE WHEN $3::lost_item_status = 'opgehaald' THEN coalesce(collected_at, now()) ELSE NULL END
        WHERE id = $1 AND festival_id = $2 RETURNING ${LOST_ITEM_COLUMNS}`,
      [id, requireFestival(ctx), status],
    )
    if (!rows[0]) throw notFound()
    await audit(db, user.id, 'lost_item.update', { type: 'lost_item', id }, { status })
    return { status: 200, body: toLostItem(rows[0]) }
  })

  r.delete('/admin/lost-items/:lostItemId', { operationId: 'deleteLostItem', roles: ORGANISERS }, async (ctx) => {
    const user = requireUser(ctx)
    const id = uuidParam(ctx, 'lostItemId')
    const { rowCount } = await db.query('DELETE FROM lost_items WHERE id = $1 AND festival_id = $2', [id, requireFestival(ctx)])
    if (!rowCount) throw notFound()
    await audit(db, user.id, 'lost_item.delete', { type: 'lost_item', id })
    return { status: 204 }
  })
}
