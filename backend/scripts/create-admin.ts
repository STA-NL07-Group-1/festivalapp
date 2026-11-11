// Maakt een account voor het beheerportal aan (of zet het wachtwoord opnieuw en logt alle sessies uit)
// en geeft het een rol bij één festival.
//
//   ADMIN_EMAIL=jij@school.nl ADMIN_NAME="Gijs" ADMIN_ROLE=beheerder ADMIN_PASSWORD='…' node scripts/create-admin.ts
//
// Het wachtwoord komt uit een omgevingsvariabele, zodat het niet in je shell-geschiedenis
// als argument staat. Rol: "beheerder", "organisatie", "ehbo" of "beveiliging".
// Zonder ADMIN_FESTIVAL (de id van een festival) is het het eerste festival.
// Daarna kan dit ook gewoon in het portal, op de pagina Team.
import { pathToFileURL } from 'node:url'
import pg from 'pg'
import { loadConfig } from '../src/config.ts'
import { hashPassword, isWeakPassword } from '../src/security.ts'

const ROLES = ['beheerder', 'organisatie', 'ehbo', 'beveiliging']

export async function createAdmin(databaseUrl: string, input: { email: string; name: string; role: string; password: string; festivalId?: string }) {
  const email = input.email.trim().toLowerCase()
  if (!ROLES.includes(input.role)) throw new Error(`ADMIN_ROLE moet een van deze zijn: ${ROLES.join(', ')}`)
  if (input.password.length < 12 || isWeakPassword(input.password, email)) throw new Error('Kies een sterker wachtwoord (minstens 12 tekens)')
  const client = new pg.Client({ connectionString: databaseUrl })
  await client.connect()
  try {
    const festival = await client.query<{ id: string; name: string }>(
      'SELECT id, name FROM festivals WHERE $1::uuid IS NULL OR id = $1 ORDER BY created_at LIMIT 1',
      [input.festivalId ?? null],
    )
    if (!festival.rows[0]) throw new Error('Dit festival bestaat niet (ADMIN_FESTIVAL)')
    const hash = await hashPassword(input.password)
    await client.query('BEGIN')
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO users (email, password_hash, display_name) VALUES ($1, $2, $3)
       ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash,
         failed_logins = 0, locked_until = NULL
       RETURNING id`,
      [email, hash, input.name.trim() || 'Organisatie'],
    )
    await client.query(
      `INSERT INTO festival_members (festival_id, user_id, role) VALUES ($1, $2, $3)
       ON CONFLICT (festival_id, user_id) DO UPDATE SET role = EXCLUDED.role`,
      [festival.rows[0].id, rows[0]!.id, input.role],
    )
    // Bij een nieuw wachtwoord moeten oude sessies ook stoppen, anders blijft wie al ingelogd was gewoon binnen
    await client.query('UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [rows[0]!.id])
    await client.query(`INSERT INTO audit_log (actor_id, action, target_type, target_id) VALUES (NULL, 'account.create_admin', 'user', $1)`, [
      rows[0]!.id,
    ])
    await client.query('COMMIT')
    return `${email} (${input.role} bij ${festival.rows[0].name})`
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {})
    throw error
  } finally {
    await client.end()
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const env = process.env
  createAdmin(loadConfig().databaseUrl, {
    email: env.ADMIN_EMAIL ?? '',
    name: env.ADMIN_NAME ?? 'Organisatie',
    role: env.ADMIN_ROLE ?? 'organisatie',
    password: env.ADMIN_PASSWORD ?? '',
    festivalId: env.ADMIN_FESTIVAL || undefined,
  })
    .then((who) => console.log(`Account ${who} is klaar. Log in op /beheer.`))
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : error)
      process.exit(1)
    })
}
