// Maakt een account voor het beheerportal aan (of zet het wachtwoord opnieuw).
//
//   ADMIN_EMAIL=jij@school.nl ADMIN_NAME="Gijs" ADMIN_ROLE=beheerder ADMIN_PASSWORD='…' node scripts/create-admin.ts
//
// Het wachtwoord komt uit een omgevingsvariabele, zodat het niet in je shell-geschiedenis
// als argument staat. Rol: "organisatie" of "beheerder" (mag ook tickets importeren).
import { pathToFileURL } from 'node:url'
import pg from 'pg'
import { loadConfig } from '../src/config.ts'
import { hashPassword, isWeakPassword } from '../src/security.ts'

export async function createAdmin(databaseUrl: string, input: { email: string; name: string; role: string; password: string }) {
  const email = input.email.trim().toLowerCase()
  if (!['organisatie', 'beheerder'].includes(input.role)) throw new Error('ADMIN_ROLE moet "organisatie" of "beheerder" zijn')
  if (input.password.length < 12 || isWeakPassword(input.password, email)) throw new Error('Kies een sterker wachtwoord (minstens 12 tekens)')
  const client = new pg.Client({ connectionString: databaseUrl })
  await client.connect()
  try {
    const hash = await hashPassword(input.password)
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO users (email, password_hash, display_name, role) VALUES ($1, $2, $3, $4)
       ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash, role = EXCLUDED.role,
         failed_logins = 0, locked_until = NULL
       RETURNING id`,
      [email, hash, input.name.trim() || 'Organisatie', input.role],
    )
    await client.query(`INSERT INTO audit_log (actor_id, action, target_type, target_id) VALUES (NULL, 'account.create_admin', 'user', $1)`, [
      rows[0]!.id,
    ])
    return email
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
  })
    .then((email) => console.log(`Account ${email} is klaar. Log in op /beheer.`))
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : error)
      process.exit(1)
    })
}
