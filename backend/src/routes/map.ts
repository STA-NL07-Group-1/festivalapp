// Kaartpunten: wifi, EHBO, water, ingang, oplaadpunten enzovoort.
// Iedereen die is ingelogd mag ze lezen; alleen de organisatie mag ze aanpassen.
import type { Deps } from '../app.ts'
import { audit } from '../db.ts'
import { ORGANISERS, badRequest, notFound, requireFestival, requireUser, uuidParam, type Router } from '../http.ts'
import { MAP_POINT_COLUMNS, toMapPoint } from './mappers.ts'

type MapPointInput = {
  kind?: string
  name?: string
  description?: string | null
  latitude?: number
  longitude?: number
}

export function mapRoutes(r: Router, deps: Deps): void {
  const { db } = deps

  r.get('/map-points', { operationId: 'listMapPoints' }, async (ctx) => {
    const { rows } = await db.query(`SELECT ${MAP_POINT_COLUMNS} FROM map_points WHERE festival_id = $1 ORDER BY kind, name LIMIT 500`, [requireFestival(ctx)])
    return { status: 200, body: rows.map(toMapPoint) }
  })

  r.post('/admin/map-points', { operationId: 'createMapPoint', roles: ORGANISERS }, async (ctx) => {
    const user = requireUser(ctx)
    const festivalId = requireFestival(ctx)
    const b = ctx.body as Required<Omit<MapPointInput, 'description'>> & { description?: string }
    const name = b.name.trim()
    if (!name) throw badRequest('Geef het punt een naam.')
    const { rows } = await db.query(
      `INSERT INTO map_points (festival_id, kind, name, description, latitude, longitude, created_by)
       VALUES ($7, $1, $2, $3, $4, $5, $6) RETURNING ${MAP_POINT_COLUMNS}`,
      [b.kind, name, b.description?.trim() || null, b.latitude, b.longitude, user.id, festivalId],
    )
    const point = toMapPoint(rows[0]!)
    await audit(db, user.id, 'map_point.create', { type: 'map_point', id: String(point.id) })
    deps.realtime.toFestival(festivalId, 'map_point.update', point)
    return { status: 201, body: point }
  })

  r.patch('/admin/map-points/:mapPointId', { operationId: 'updateMapPoint', roles: ORGANISERS }, async (ctx) => {
    const user = requireUser(ctx)
    const id = uuidParam(ctx, 'mapPointId')
    const festivalId = requireFestival(ctx)
    const b = ctx.body as MapPointInput
    if (b.name !== undefined && !b.name.trim()) throw badRequest('Geef het punt een naam.')
    // description: weglaten = niets veranderen, null of "" = leegmaken
    const clearDescription = b.description === null || b.description?.trim() === ''
    const { rows } = await db.query(
      `UPDATE map_points SET
          kind        = coalesce($2::map_point_kind, kind),
          name        = coalesce($3, name),
          description = CASE WHEN $4 THEN NULL ELSE coalesce($5, description) END,
          latitude    = coalesce($6, latitude),
          longitude   = coalesce($7, longitude)
        WHERE id = $1 AND festival_id = $8 RETURNING ${MAP_POINT_COLUMNS}`,
      [id, b.kind ?? null, b.name?.trim() ?? null, clearDescription, clearDescription ? null : (b.description?.trim() ?? null), b.latitude ?? null, b.longitude ?? null, festivalId],
    )
    if (!rows[0]) throw notFound()
    const point = toMapPoint(rows[0])
    await audit(db, user.id, 'map_point.update', { type: 'map_point', id }, b)
    deps.realtime.toFestival(festivalId, 'map_point.update', point)
    return { status: 200, body: point }
  })

  r.delete('/admin/map-points/:mapPointId', { operationId: 'deleteMapPoint', roles: ORGANISERS }, async (ctx) => {
    const user = requireUser(ctx)
    const id = uuidParam(ctx, 'mapPointId')
    const festivalId = requireFestival(ctx)
    const { rowCount } = await db.query('DELETE FROM map_points WHERE id = $1 AND festival_id = $2', [id, festivalId])
    if (!rowCount) throw notFound()
    await audit(db, user.id, 'map_point.delete', { type: 'map_point', id })
    deps.realtime.toFestival(festivalId, 'map_point.removed', { id })
    return { status: 204 }
  })
}
