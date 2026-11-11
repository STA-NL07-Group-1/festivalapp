// Maakt één bestaand account "sudo": dat account mag bij elk festival en is het enige
// dat eigenaren en beheerders kan aanwijzen. Er is altijd hoogstens één sudo.
//
//   SUDO_EMAIL=jij@school.nl node scripts/set-sudo.ts
//
// Dit kan bewust NIET via het portal of de API: alleen wie op de server kan, kan dit doen.
// Was een ander account sudo, dan wordt dat een gewone eigenaar.
import { pathToFileURL } from 'node:url'
import pg from 'pg'
import { loadConfig } from '../src/config.ts'

export async function setSudo(databaseUrl: string, emailInput: string): Promise<string> {
  const email = emailInput.trim().toLowerCase()
  if (!email) throw new Error('Geef het e-mailadres op met SUDO_EMAIL')
  const client = new pg.Client({ connectionString: databaseUrl })
  await client.connect()
  try {
    await client.query('BEGIN')
    const user = await client.query<{ id: string }>('SELECT id FROM users WHERE email = $1 FOR UPDATE', [email])
    if (!user.rows[0]) throw new Error(`Er is geen account met het e-mailadres ${email}. Maak het account eerst aan.`)
    await client.query(`UPDATE users SET platform_role = 'eigenaar' WHERE platform_role = 'sudo' AND id <> $1`, [user.rows[0].id])
    await client.query(`UPDATE users SET platform_role = 'sudo' WHERE id = $1`, [user.rows[0].id])
    await client.query(`INSERT INTO audit_log (actor_id, action, target_type, target_id) VALUES (NULL, 'owner.set_sudo', 'user', $1)`, [user.rows[0].id])
    await client.query('COMMIT')
    return email
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {})
    throw error
  } finally {
    await client.end()
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  setSudo(loadConfig().databaseUrl, process.env.SUDO_EMAIL ?? '')
    .then((email) => console.log(`${email} is nu sudo. Log opnieuw in op /beheer.`))
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : error)
      process.exit(1)
    })
}
