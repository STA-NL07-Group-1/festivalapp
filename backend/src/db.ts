import pg from 'pg'

export type Db = pg.Pool
export type Queryable = pg.Pool | pg.PoolClient

export function createPool(connectionString: string): pg.Pool {
  return new pg.Pool({ connectionString, max: 20, idleTimeoutMillis: 30_000 })
}

/** Voer `fn` uit in één transactie. */
export async function transaction<T>(db: pg.Pool, fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await db.connect()
  try {
    await client.query('BEGIN')
    const result = await fn(client)
    await client.query('COMMIT')
    return result
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

/** Schrijf een regel in de append-only audit_log. Actie: "domein.actie". */
export async function audit(
  db: Queryable,
  actorId: string | null,
  action: string,
  target?: { type: string; id: string },
  details: Record<string, unknown> = {},
): Promise<void> {
  await db.query(
    'INSERT INTO audit_log (actor_id, action, target_type, target_id, details) VALUES ($1, $2, $3, $4, $5)',
    [actorId, action, target?.type ?? null, target?.id ?? null, JSON.stringify(details)],
  )
}

/** Vriendschap bestaat? (paar wordt geordend opgeslagen) */
export async function areFriends(db: Queryable, a: string, b: string): Promise<boolean> {
  if (a === b) return false
  const [x, y] = a < b ? [a, b] : [b, a]
  const { rowCount } = await db.query('SELECT 1 FROM friendships WHERE user_a = $1 AND user_b = $2', [x, y])
  return (rowCount ?? 0) > 0
}

export async function friendIds(db: Queryable, userId: string): Promise<string[]> {
  const { rows } = await db.query<{ id: string }>(
    `SELECT CASE WHEN user_a = $1 THEN user_b ELSE user_a END AS id
       FROM friendships WHERE user_a = $1 OR user_b = $1`,
    [userId],
  )
  return rows.map((r) => r.id)
}
