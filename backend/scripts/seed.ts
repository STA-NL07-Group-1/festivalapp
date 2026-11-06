// Vult een LEGE ontwikkeldatabase met demo-data: podia, een timetable van drie dagen
// (vanaf vandaag), 50 tickets en een paar accounts. Weigert te draaien in productie.
import { pathToFileURL } from 'node:url'
import pg from 'pg'
import { loadConfig } from '../src/config.ts'
import { hashPassword, sha256 } from '../src/security.ts'

export const DEMO_PASSWORD = 'Festival-demo-2026'

const STAGES = [
  { name: 'Hoofdpodium', lat: 52.3868, lng: 4.8745, capacity: 15000 },
  { name: 'The Tent', lat: 52.3879, lng: 4.8772, capacity: 4000 },
  { name: 'Bosstage', lat: 52.3855, lng: 4.8781, capacity: 2500 },
  { name: 'Silent Disco', lat: 52.3872, lng: 4.8803, capacity: 300 },
]

const ARTISTS = [
  'Nova Lights', 'De Kraaien', 'Moonwalk Society', 'Sara Vos', 'Electric Tulips', 'Bas & de Basstanten',
  'Neon Harbor', 'Lotte Lux', 'The Polder Boys', 'Echo Echo', 'Velvet Dunes', 'DJ Windmolen',
  'Kaas & Kracht', 'Sunset Parade', 'Mira Mondo', 'Fietsbel Orkest', 'Glow Collective', 'Ruben Rood',
  'Golden Hour', 'Noordzee Kabaal', 'Pixel Prinses', 'The Late Trains', 'Stroopwafel Soundsystem', 'Hemelsblauw',
]

export async function seed(databaseUrl: string, log = console.log): Promise<void> {
  const client = new pg.Client({ connectionString: databaseUrl })
  await client.connect()
  try {
    const existing = await client.query('SELECT count(*)::int AS n FROM stages')
    if (existing.rows[0].n > 0) {
      log('De database bevat al data; seed wordt overgeslagen.')
      return
    }
    await client.query('BEGIN')

    const stageIds: string[] = []
    for (const [i, s] of STAGES.entries()) {
      const { rows } = await client.query(
        'INSERT INTO stages (name, latitude, longitude, capacity, sort_order) VALUES ($1, $2, $3, $4, $5) RETURNING id',
        [s.name, s.lat, s.lng, s.capacity, i + 1],
      )
      stageIds.push(rows[0].id)
    }

    // Drie dagen, vanaf vandaag 14:00 (tijdzone van de database-server)
    let artist = 0
    for (let day = 0; day < 3; day++) {
      for (const [stageIndex, stageId] of stageIds.entries()) {
        for (let slot = 0; slot < 2; slot++) {
          const name = ARTISTS[artist++ % ARTISTS.length]!
          const startHour = 14 + stageIndex + slot * 4
          const isSilentDisco = stageIndex === 3
          await client.query(
            `INSERT INTO performances (stage_id, artist, description, starts_at, ends_at, signup_capacity)
             VALUES ($1, $2, $3,
               date_trunc('day', now()) + make_interval(days => $4, hours => $5),
               date_trunc('day', now()) + make_interval(days => $4, hours => $5, mins => 75),
               $6)`,
            [stageId, name, isSilentDisco ? 'Koptelefoon ophalen bij de ingang van de tent.' : null, day, startHour, isSilentDisco ? 150 : null],
          )
        }
      }
    }

    // Tickets DEMO-0001 … DEMO-0050
    for (let i = 1; i <= 50; i++) {
      await client.query(
        `INSERT INTO tickets (code_hash, valid_from, valid_until) VALUES ($1, now() - interval '1 day', now() + interval '30 days')`,
        [sha256(`DEMO-${String(i).padStart(4, '0')}`)],
      )
    }

    const passwordHash = await hashPassword(DEMO_PASSWORD)
    const staff = [
      { email: 'organisatie@festival.test', name: 'Organisatie', role: 'organisatie' },
      { email: 'beheerder@festival.test', name: 'Beheerder', role: 'beheerder' },
    ]
    for (const s of staff) {
      await client.query('INSERT INTO users (email, password_hash, display_name, role) VALUES ($1, $2, $3, $4)', [
        s.email,
        passwordHash,
        s.name,
        s.role,
      ])
    }

    // Twee bezoekers die al vrienden zijn (gebruiken tickets 0049 en 0050)
    const visitors: string[] = []
    for (const [i, v] of [
      { email: 'anna@festival.test', name: 'Anna', ticket: 'DEMO-0049' },
      { email: 'bram@festival.test', name: 'Bram', ticket: 'DEMO-0050' },
    ].entries()) {
      const { rows } = await client.query(
        `UPDATE tickets SET status = 'gekoppeld' WHERE code_hash = $1 RETURNING id`,
        [sha256(v.ticket)],
      )
      const user = await client.query(
        `INSERT INTO users (ticket_id, email, password_hash, display_name, share_location, share_timetable)
         VALUES ($1, $2, $3, $4, true, true) RETURNING id`,
        [rows[0].id, v.email, passwordHash, v.name],
      )
      visitors[i] = user.rows[0].id
    }
    const [a, b] = [visitors[0]!, visitors[1]!].sort()
    await client.query('INSERT INTO friendships (user_a, user_b) VALUES ($1, $2)', [a, b])
    await client.query(
      `INSERT INTO locations (user_id, latitude, longitude, accuracy_m, expires_at)
       VALUES ($1, 52.3870, 4.8760, 15, now() + interval '10 minutes')`,
      [visitors[1]],
    )
    await client.query(
      `INSERT INTO timetable_entries (user_id, performance_id)
       SELECT $1, id FROM performances ORDER BY starts_at LIMIT 3`,
      [visitors[1]],
    )
    await client.query(
      `INSERT INTO announcements (level, title_nl, title_en, body_nl, body_en)
       VALUES ('info', 'Welkom!', 'Welcome!', 'Fijn dat je er bent. Drink genoeg water.', 'Great to have you here. Stay hydrated.')`,
    )

    await client.query('COMMIT')
    log('Demo-data aangemaakt.')
    log(`  Tickets:      DEMO-0001 t/m DEMO-0048 (vrij om mee te registreren)`)
    log(`  Bezoekers:    anna@festival.test, bram@festival.test`)
    log(`  Portal:       organisatie@festival.test, beheerder@festival.test`)
    log(`  Wachtwoord:   ${DEMO_PASSWORD}  (alleen lokaal!)`)
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {})
    throw error
  } finally {
    await client.end()
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const config = loadConfig()
  if (config.env === 'production') {
    console.error('Seed draait niet in productie.')
    process.exit(1)
  }
  seed(config.databaseUrl).catch((error: unknown) => {
    console.error(error)
    process.exit(1)
  })
}
