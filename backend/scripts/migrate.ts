// Voert nieuwe migraties uit backend/db/migrations uit, in volgorde.
// Welke al gedraaid zijn, staat in de tabel schema_migrations.
import { readdirSync, readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import pg from 'pg'
import { loadConfig } from '../src/config.ts'

const dir = new URL('../db/migrations/', import.meta.url)

export async function migrate(databaseUrl: string, log = console.log): Promise<void> {
  const client = new pg.Client({ connectionString: databaseUrl })
  await client.connect()
  try {
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      name text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`)
    const done = new Set((await client.query<{ name: string }>('SELECT name FROM schema_migrations')).rows.map((r) => r.name))
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- vaste map in de repository
    const files = readdirSync(dir).filter((f) => /^\d{4}_[a-z0-9_]+\.sql$/.test(f)).sort()
    for (const file of files) {
      if (done.has(file)) continue
      log(`→ ${file}`)
      // Elke migratie heeft zelf BEGIN/COMMIT
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- bestandsnaam gecontroleerd met regex hierboven
      await client.query(readFileSync(new URL(file, dir), 'utf8'))
      await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file])
    }
    log('Database is bijgewerkt.')
  } finally {
    await client.end()
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  migrate(loadConfig().databaseUrl).catch((error: unknown) => {
    console.error(error)
    process.exit(1)
  })
}
