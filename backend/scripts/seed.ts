// Vult een LEGE database met testdata: twee festivals, podia, een timetable van drie dagen
// (vanaf vandaag), tickets en een paar accounts met een bekend wachtwoord. Alles is verzonnen.
//
//   npm run db:seed                  alles (alleen lokaal; weigert in productie)
//   node scripts/seed.ts --programma alleen podia + timetable, ook in productie toegestaan
import { pathToFileURL } from 'node:url'
import pg from 'pg'
import { loadConfig } from '../src/config.ts'
import { hashPassword, sha256 } from '../src/security.ts'

export const DEMO_PASSWORD = 'Festival-demo-2026'
/** Het eerste festival; wordt aangemaakt door migratie 0004 */
export const FIRST_FESTIVAL = '00000000-0000-4000-8000-000000000001'
/** Een tweede testfestival, om het wisselen tussen festivals te kunnen proberen */
export const SECOND_FESTIVAL = '00000000-0000-4000-8000-000000000002'

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

export async function seed(databaseUrl: string, log = console.log, { programOnly = false } = {}): Promise<void> {
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
        'INSERT INTO stages (festival_id, name, latitude, longitude, capacity, sort_order) VALUES ($6, $1, $2, $3, $4, $5) RETURNING id',
        [s.name, s.lat, s.lng, s.capacity, i + 1, FIRST_FESTIVAL],
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

    if (programOnly) {
      await client.query('COMMIT')
      log('Podia en timetable aangemaakt (zonder accounts en tickets).')
      return
    }

    // Een paar kaartpunten rond het hoofdpodium (alleen demo; in productie zet de organisatie ze zelf)
    const base = STAGES[0]!
    const points: [string, string, number, number][] = [
      ['wifi', 'Wifi bij de ingang', 0.0006, -0.0009],
      ['wifi', 'Wifi bij het eetplein', -0.0007, 0.0008],
      ['ehbo', 'EHBO-post', -0.0004, -0.0006],
      ['water', 'Gratis water', 0.0003, 0.0007],
      ['ingang', 'Hoofdingang', 0.0009, -0.0012],
      ['oplaadpunt', 'Oplaadpunt bandjes', 0.0005, 0.0003],
    ]
    for (const [kind, name, dLat, dLng] of points) {
      await client.query('INSERT INTO map_points (festival_id, kind, name, latitude, longitude) VALUES ($5, $1, $2, $3, $4)', [kind, name, base.lat + dLat, base.lng + dLng, FIRST_FESTIVAL])
    }

    // Tickets DEMO-0001 … DEMO-0050 voor het eerste festival
    for (let i = 1; i <= 50; i++) {
      await client.query(
        `INSERT INTO tickets (festival_id, code_hash, valid_from, valid_until) VALUES ($2, $1, now() - interval '1 day', now() + interval '30 days')`,
        [sha256(`DEMO-${String(i).padStart(4, '0')}`), FIRST_FESTIVAL],
      )
    }

    // Tweede testfestival met een eigen podium, kaartpunt en tickets TWEE-0001 … TWEE-0010
    await client.query(
      `INSERT INTO festivals (id, name, starts_at, ends_at)
       VALUES ($1, 'Tweede Testfestival', now() - interval '1 hour', date_trunc('day', now()) + interval '30 days')`,
      [SECOND_FESTIVAL],
    )
    const second = await client.query(
      `INSERT INTO stages (festival_id, name, latitude, longitude, capacity, sort_order)
       VALUES ($1, 'Strandpodium', 52.1105, 4.2790, 3000, 1) RETURNING id`,
      [SECOND_FESTIVAL],
    )
    await client.query(
      `INSERT INTO performances (stage_id, artist, starts_at, ends_at)
       VALUES ($1, 'Duinpan Disco', date_trunc('day', now()) + interval '20 hours', date_trunc('day', now()) + interval '21 hours')`,
      [second.rows[0].id],
    )
    await client.query(`INSERT INTO map_points (festival_id, kind, name, latitude, longitude) VALUES ($1, 'ehbo', 'EHBO-post strand', 52.1108, 4.2784)`, [
      SECOND_FESTIVAL,
    ])
    for (let i = 1; i <= 10; i++) {
      await client.query(
        `INSERT INTO tickets (festival_id, code_hash, valid_from, valid_until) VALUES ($2, $1, now() - interval '1 day', now() + interval '30 days')`,
        [sha256(`TWEE-${String(i).padStart(4, '0')}`), SECOND_FESTIVAL],
      )
    }

    const passwordHash = await hashPassword(DEMO_PASSWORD)
    // Personeel van het eerste festival. De rol hoort bij het festival, niet bij het account.
    const staff = [
      { email: 'beheerder@festival.test', name: 'Beheerder', role: 'beheerder' },
      { email: 'organisatie@festival.test', name: 'Organisatie', role: 'organisatie' },
      { email: 'ehbo@festival.test', name: 'EHBO', role: 'ehbo' },
      { email: 'beveiliging@festival.test', name: 'Beveiliging', role: 'beveiliging' },
    ]
    for (const s of staff) {
      const { rows } = await client.query('INSERT INTO users (email, password_hash, display_name) VALUES ($1, $2, $3) RETURNING id', [
        s.email,
        passwordHash,
        s.name,
      ])
      await client.query('INSERT INTO festival_members (festival_id, user_id, role) VALUES ($1, $2, $3)', [FIRST_FESTIVAL, rows[0].id, s.role])
    }
    // Het tweede festival heeft een eigen beheerder, om te testen dat die niet bij het eerste kan
    const other = await client.query('INSERT INTO users (email, password_hash, display_name) VALUES ($1, $2, $3) RETURNING id', [
      'beheerder2@festival.test',
      passwordHash,
      'Beheerder Twee',
    ])
    await client.query(`INSERT INTO festival_members (festival_id, user_id, role) VALUES ($1, $2, 'beheerder')`, [SECOND_FESTIVAL, other.rows[0].id])
    // Sudo: mag bij elk festival en wijst eigenaren en beheerders aan
    await client.query(`INSERT INTO users (email, password_hash, display_name, platform_role) VALUES ($1, $2, 'Sudo', 'sudo')`, [
      'sudo@festival.test',
      passwordHash,
    ])

    // Twee bezoekers die al vrienden zijn (gebruiken tickets 0049 en 0050)
    const visitors: string[] = []
    for (const [i, v] of [
      { email: 'anna@festival.test', name: 'Anna', ticket: 'DEMO-0049' },
      { email: 'bram@festival.test', name: 'Bram', ticket: 'DEMO-0050' },
    ].entries()) {
      const user = await client.query(
        `INSERT INTO users (email, password_hash, display_name, share_location, share_timetable)
         VALUES ($1, $2, $3, true, true) RETURNING id`,
        [v.email, passwordHash, v.name],
      )
      await client.query(`UPDATE tickets SET status = 'gekoppeld', user_id = $2 WHERE code_hash = $1`, [sha256(v.ticket), user.rows[0].id])
      visitors[i] = user.rows[0].id
    }
    const [a, b] = [visitors[0]!, visitors[1]!].sort()
    await client.query('INSERT INTO friendships (user_a, user_b) VALUES ($1, $2)', [a, b])
    await client.query(
      `INSERT INTO locations (user_id, festival_id, latitude, longitude, accuracy_m, expires_at)
       VALUES ($1, $2, 52.3870, 4.8760, 15, now() + interval '10 minutes')`,
      [visitors[1], FIRST_FESTIVAL],
    )
    await client.query(
      `INSERT INTO timetable_entries (user_id, performance_id)
       SELECT $1, p.id FROM performances p JOIN stages s ON s.id = p.stage_id
        WHERE s.festival_id = $2 ORDER BY p.starts_at LIMIT 3`,
      [visitors[1], FIRST_FESTIVAL],
    )
    await client.query(
      `INSERT INTO announcements (festival_id, level, title_nl, title_en, body_nl, body_en)
       VALUES ($1, 'info', 'Welkom!', 'Welcome!', 'Fijn dat je er bent. Drink genoeg water.', 'Great to have you here. Stay hydrated.')`,
      [FIRST_FESTIVAL],
    )

    await client.query('COMMIT')
    log('Demo-data aangemaakt.')
    log(`  Festivals:    Testfestival en Tweede Testfestival`)
    log(`  Tickets:      DEMO-0001 t/m DEMO-0048 (Testfestival), TWEE-0001 t/m TWEE-0010 (Tweede Testfestival)`)
    log(`  Bezoekers:    anna@festival.test, bram@festival.test`)
    log(`  Portal:       beheerder@, organisatie@, ehbo@, beveiliging@festival.test (Testfestival)`)
    log(`                beheerder2@festival.test (Tweede Testfestival), sudo@festival.test (alles)`)
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
  const programOnly = process.argv.includes('--programma')
  if (config.env === 'production' && !programOnly) {
    console.error('Demo-accounts horen niet in productie. Gebruik: node scripts/seed.ts --programma')
    process.exit(1)
  }
  seed(config.databaseUrl, console.log, { programOnly }).catch((error: unknown) => {
    console.error(error)
    process.exit(1)
  })
}
