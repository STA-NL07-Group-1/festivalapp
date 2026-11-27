// Testfestival voor de testweek: een eigen festival met podia, een timetable voor elke dag,
// kaartpunten, huisregels, vragen en ticketcodes. Alles is verzonnen en gaat er later weer uit.
// Het festival loopt van vandaag tot en met 9 december 2026, 22:00 (Nederlandse tijd).
//
//   node scripts/testfestival.ts --toevoegen               festival en alle testdata aanmaken
//   node scripts/testfestival.ts --oud-verwijderen         laten zien wat er bij het oude Testfestival staat
//   node scripts/testfestival.ts --oud-verwijderen --zeker het oude Testfestival (uit migratie 0004) verwijderen
//   node scripts/testfestival.ts --verwijderen             het testfestival van dit script weer verwijderen
//
// Op de server: dc exec backend node scripts/testfestival.ts --toevoegen
// Het script werkt ook in productie: er komen geen accounts met een bekend wachtwoord bij.
import { randomInt } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import pg from 'pg'
import { loadConfig } from '../src/config.ts'
import { sha256 } from '../src/security.ts'

/** Vaste id: zo weet --verwijderen precies welk festival van dit script is */
export const TEST_FESTIVAL = '00000000-0000-4000-8000-0000000000a1'
/** Het eerste festival uit migratie 0004 ("Testfestival") */
export const OLD_FESTIVAL = '00000000-0000-4000-8000-000000000001'
export const FESTIVAL_NAME = 'Festival Buddy Testweek'
/** Laatste dag en eindtijd, Nederlandse tijd */
export const LAST_DAY = '2026-12-09'
export const END_TIME = '22:00'
const TIME_ZONE = 'Europe/Amsterdam'
const TICKET_COUNT = 50

const STAGES = [
  { name: 'Hoofdpodium', lat: 52.3868, lng: 4.8745, capacity: 15000 },
  { name: 'The Tent', lat: 52.3879, lng: 4.8772, capacity: 4000 },
  { name: 'Bosstage', lat: 52.3855, lng: 4.8781, capacity: 2500 },
  { name: 'Silent Disco', lat: 52.3872, lng: 4.8803, capacity: 300 },
] as const

/** Verzonnen artiesten met een korte beschrijving, per podium (andere namen dan in seed.ts) */
const LINEUP: Record<(typeof STAGES)[number]['name'], [string, string][]> = {
  Hoofdpodium: [
    ['Avondrood', 'Nederlandstalige pop met een groot koor'],
    ['The Harbour Lights', 'Britse indierock met veel gitaren'],
    ['Lisa Leeuw', 'Singer-songwriter uit Groningen'],
    ['Zuiderzee Soundsystem', 'Dancehall en reggae met live blazers'],
    ['Northern Static', 'Elektronische rock uit Oslo'],
    ['Merel & de Meeuwen', 'Vrolijke folkpop om mee te zingen'],
    ['Copper Skyline', 'Stadionrock uit Manchester'],
    ['Daan Dageraad', 'Nederlandstalige hiphop'],
    ['Polar Parade', 'Synthpop met veel lichtshow'],
    ['Kade 12', 'Rockband uit Rotterdam'],
    ['Saffron Waves', 'Psychedelische pop uit Australië'],
    ['Het Lange Weekend', 'Feestband met covers van vroeger en nu'],
  ],
  'The Tent': [
    ['Bass Molen', 'Drum and bass uit Eindhoven'],
    ['Nachtvlinder', 'Melodische techno'],
    ['Fenna Fluks', 'House met live viool'],
    ['Low Tide Club', 'Deep house uit Lissabon'],
    ['Stoomtram', 'Hardstyle met een knipoog'],
    ['Midnight Ferry', 'Disco en funk uit de jaren 80'],
    ['Kobalt', 'Techno uit Berlijn'],
    ['Sunny Side Up', 'Zonnige afrohouse'],
    ['Mr. Metronoom', 'Breakbeat en electro'],
    ['Pixelhaven', 'Chiptune en dance'],
  ],
  Bosstage: [
    ['Varen & Mos', 'Akoestische folk tussen de bomen'],
    ['June Moon', 'Dromerige indiefolk uit Canada'],
    ['Het Houten Huis', 'Americana uit Drenthe'],
    ['Wildpluk', 'Jazz met een strijkkwartet'],
    ['Olive Grove', 'Akoestische soul'],
    ['Echoput', 'Postrock zonder zang'],
    ['Ruis & Riet', 'Ambient met veldopnames'],
    ['Thijs Takkebos', 'Liedjesschrijver met gitaar'],
    ['Blue Hour Trio', 'Jazztrio uit Amsterdam'],
  ],
  'Silent Disco': [
    ['DJ Koptelefoon', 'Drie kanalen: pop, house en jaren 90'],
    ['De Fluisteraars', 'Silent disco met meezingers'],
    ['Channel Blue', 'Alleen hits van nu'],
    ['Stille Nacht Crew', 'Silent disco met foute hits'],
  ],
}

/** Workshops op de Bosstage met aanmelding */
const WORKSHOPS: [string, string][] = [
  ['Workshop: djembé spelen', 'Leer in een uur de basis van de djembé. Aanmelden in de app, maximaal 30 plekken.'],
  ['Workshop: yoga in het bos', 'Rustige yogales voor iedereen. Neem een handdoek mee. Maximaal 30 plekken.'],
  ['Workshop: liedjes schrijven', 'Samen in een uur een liedje maken. Maximaal 30 plekken.'],
]

export interface PlannedPerformance {
  stage: (typeof STAGES)[number]['name']
  artist: string
  description: string
  /** Nederlandse tijd, 'YYYY-MM-DD HH:MM' */
  startsAt: string
  endsAt: string
  status: 'gepland' | 'vertraagd' | 'verplaatst' | 'geannuleerd'
  signupCapacity: number | null
}

/** Speeltijden in minuten, steeds om de beurt; ombouwtijd ertussen */
const SET_LENGTHS = [60, 75, 45, 90, 60]
const CHANGEOVERS = [15, 20, 30, 15]

const pad = (n: number) => String(n).padStart(2, '0')
const clock = (minutes: number) => `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`
const minutesOf = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5))

/** Alle dagen van `first` tot en met LAST_DAY, als 'YYYY-MM-DD' */
export function festivalDays(first: string, last = LAST_DAY): string[] {
  const days: string[] = []
  for (let d = new Date(`${first}T12:00:00Z`); d.toISOString().slice(0, 10) <= last; d.setUTCDate(d.getUTCDate() + 1)) {
    days.push(d.toISOString().slice(0, 10))
  }
  return days
}

/**
 * De timetable voor deze dagen. Elke dag begint het programma om 13:00 (Silent Disco om 19:00) en
 * stopt om 23:00; op de laatste dag om 22:00, als het festival eindigt. Altijd hetzelfde resultaat
 * voor dezelfde dagen, zodat het te testen is.
 */
export function buildTimetable(days: string[]): PlannedPerformance[] {
  const planned: PlannedPerformance[] = []
  let counter = 0
  for (const [dayIndex, day] of days.entries()) {
    const closing = day === LAST_DAY ? minutesOf(END_TIME) : 23 * 60
    for (const [stageIndex, stage] of STAGES.entries()) {
      const acts = LINEUP[stage.name]
      let time = stage.name === 'Silent Disco' ? 19 * 60 : 13 * 60 + stageIndex * 30
      let slot = 0
      while (true) {
        const silent = stage.name === 'Silent Disco'
        const workshop = stage.name === 'Bosstage' && slot === 0
        const length = silent ? 90 : workshop ? 60 : SET_LENGTHS[(dayIndex + stageIndex + slot) % SET_LENGTHS.length]!
        if (time + length > closing) break
        const [artist, description] = workshop
          ? WORKSHOPS[dayIndex % WORKSHOPS.length]!
          : acts[(dayIndex * 3 + slot + stageIndex) % acts.length]!
        // Een paar optredens met een andere status, om de labels in de app te kunnen testen
        counter++
        const status = counter % 29 === 0 ? 'geannuleerd' : counter % 23 === 0 ? 'verplaatst' : counter % 17 === 0 ? 'vertraagd' : 'gepland'
        planned.push({
          stage: stage.name,
          artist,
          description,
          startsAt: `${day} ${clock(time)}`,
          endsAt: `${day} ${clock(time + length)}`,
          status,
          signupCapacity: silent ? 150 : workshop ? 30 : null,
        })
        time += length + CHANGEOVERS[(slot + dayIndex) % CHANGEOVERS.length]!
        slot++
      }
    }
  }
  return planned
}

/** Ticketcode zoals TEST-K7QM-3XRA (zonder 0/O en 1/I, die lijken op elkaar) */
function ticketCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const part = () => Array.from({ length: 4 }, () => chars[randomInt(chars.length)]).join('')
  return `TEST-${part()}-${part()}`
}

/** Vandaag in Nederland, als 'YYYY-MM-DD' */
const todayInNl = () => new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE }).format(new Date())

async function withClient<T>(databaseUrl: string, work: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: databaseUrl })
  await client.connect()
  try {
    await client.query('BEGIN')
    const result = await work(client)
    await client.query('COMMIT')
    return result
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {})
    throw error
  } finally {
    await client.end()
  }
}

export async function addTestFestival(databaseUrl: string, log = console.log, today = todayInNl()): Promise<string[]> {
  if (today > LAST_DAY) throw new Error(`Het testfestival eindigt op ${LAST_DAY}; vandaag is dat al voorbij.`)
  return withClient(databaseUrl, async (client) => {
    const exists = await client.query('SELECT 1 FROM festivals WHERE id = $1', [TEST_FESTIVAL])
    if (exists.rowCount) throw new Error(`${FESTIVAL_NAME} bestaat al. Eerst --verwijderen als je opnieuw wilt beginnen.`)

    await client.query(
      `INSERT INTO festivals (id, name, starts_at, ends_at, house_rules_nl, house_rules_en)
       VALUES ($1, $2, ($3::date)::timestamp AT TIME ZONE $5, ($4)::timestamp AT TIME ZONE $5, $6, $7)`,
      [
        TEST_FESTIVAL,
        FESTIVAL_NAME,
        today,
        `${LAST_DAY} ${END_TIME}`,
        TIME_ZONE,
        'Geen glas, drugs of wapens op het terrein.\nRespecteer elkaar: geen intimidatie of discriminatie.\nVolg altijd de aanwijzingen van beveiliging en EHBO.\nOnder de 18 geen alcohol.',
        'No glass, drugs or weapons on site.\nRespect each other: no intimidation or discrimination.\nAlways follow instructions from security and first aid.\nNo alcohol under 18.',
      ],
    )

    const stageIds = new Map<string, string>()
    for (const [i, s] of STAGES.entries()) {
      const { rows } = await client.query<{ id: string }>(
        'INSERT INTO stages (festival_id, name, latitude, longitude, capacity, sort_order) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
        [TEST_FESTIVAL, s.name, s.lat, s.lng, s.capacity, i + 1],
      )
      stageIds.set(s.name, rows[0]!.id)
    }

    const timetable = buildTimetable(festivalDays(today))
    for (const p of timetable) {
      await client.query(
        `INSERT INTO performances (stage_id, artist, description, starts_at, ends_at, status, signup_capacity)
         VALUES ($1, $2, $3, ($4)::timestamp AT TIME ZONE $8, ($5)::timestamp AT TIME ZONE $8, $6, $7)`,
        [stageIds.get(p.stage), p.artist, p.description, p.startsAt, p.endsAt, p.status, p.signupCapacity, TIME_ZONE],
      )
    }

    const base = STAGES[0]
    const points: [string, string, number, number][] = [
      ['ingang', 'Hoofdingang', 0.0009, -0.0012],
      ['info', 'Infobalie', 0.0008, -0.0008],
      ['ehbo', 'EHBO-post', -0.0004, -0.0006],
      ['water', 'Gratis water', 0.0003, 0.0007],
      ['wifi', 'Wifi bij het eetplein', -0.0007, 0.0008],
      ['eten', 'Eetplein', -0.0008, 0.0011],
      ['toilet', 'Toiletten', 0.0002, -0.0015],
      ['oplaadpunt', 'Oplaadpunt telefoons', 0.0005, 0.0003],
    ]
    for (const [kind, name, dLat, dLng] of points) {
      await client.query('INSERT INTO map_points (festival_id, kind, name, latitude, longitude) VALUES ($1, $2, $3, $4, $5)', [
        TEST_FESTIVAL,
        kind,
        name,
        base.lat + dLat,
        base.lng + dLng,
      ])
    }

    const faq: [string, string, string, string][] = [
      ['Mag ik eten en drinken meenemen?', 'Can I bring food and drinks?', 'Een lege drinkfles mag mee; die vul je gratis bij de tappunten.', 'An empty bottle is allowed; refill it for free at the water points.'],
      ['Waar kan ik mijn telefoon opladen?', 'Where can I charge my phone?', 'Bij het oplaadpunt naast het hoofdpodium.', 'At the charging point next to the main stage.'],
      ['Hoe meld ik me aan voor een workshop?', 'How do I sign up for a workshop?', 'Open de workshop in de timetable en tik op Aanmelden. Vol is vol.', 'Open the workshop in the timetable and tap Sign up. Places are limited.'],
    ]
    for (const [i, [qNl, qEn, aNl, aEn]] of faq.entries()) {
      await client.query(
        'INSERT INTO faq_items (festival_id, question_nl, question_en, answer_nl, answer_en, sort_order) VALUES ($1, $2, $3, $4, $5, $6)',
        [TEST_FESTIVAL, qNl, qEn, aNl, aEn, i],
      )
    }

    // Het personeel van het oude Testfestival krijgt dezelfde rol bij dit festival
    const staff = await client.query(
      `INSERT INTO festival_members (festival_id, user_id, role, added_by)
       SELECT $1, user_id, role, added_by FROM festival_members WHERE festival_id = $2
       ON CONFLICT DO NOTHING`,
      [TEST_FESTIVAL, OLD_FESTIVAL],
    )

    // Ticketcodes: alleen de hash gaat de database in, de codes zelf zie je maar één keer
    const codes: string[] = []
    while (codes.length < TICKET_COUNT) {
      const code = ticketCode()
      const { rowCount } = await client.query(
        `INSERT INTO tickets (festival_id, code_hash, valid_from, valid_until)
         SELECT $1, $2, starts_at, ends_at FROM festivals WHERE id = $1
         ON CONFLICT (code_hash) DO NOTHING`,
        [TEST_FESTIVAL, sha256(code)],
      )
      if (rowCount) codes.push(code)
    }

    log(`${FESTIVAL_NAME} aangemaakt: van ${today} tot en met ${LAST_DAY} ${END_TIME}.`)
    log(`  ${STAGES.length} podia, ${timetable.length} optredens, ${points.length} kaartpunten, ${faq.length} vragen`)
    log(`  ${staff.rowCount ?? 0} personeelsleden van het oude Testfestival overgenomen`)
    log(`  ${codes.length} ticketcodes (bewaar ze, ze worden niet nog een keer getoond):`)
    for (let i = 0; i < codes.length; i += 5) log(`    ${codes.slice(i, i + 5).join('  ')}`)
    return codes
  })
}

/** Optredens eerst: podia mogen niet weg zolang er optredens op staan (ON DELETE RESTRICT) */
async function deleteFestival(client: pg.Client, id: string): Promise<void> {
  await client.query('DELETE FROM performances WHERE stage_id IN (SELECT id FROM stages WHERE festival_id = $1)', [id])
  await client.query('DELETE FROM festivals WHERE id = $1', [id])
}

/** Wat er bij een festival hoort; laat zien wat er weggaat voordat het echt gebeurt */
async function contents(client: pg.Client, id: string) {
  const { rows } = await client.query<Record<string, number | string>>(
    `SELECT f.name,
            (SELECT count(*)::int FROM stages WHERE festival_id = f.id) AS podia,
            (SELECT count(*)::int FROM performances p JOIN stages s ON s.id = p.stage_id WHERE s.festival_id = f.id) AS optredens,
            (SELECT count(*)::int FROM tickets WHERE festival_id = f.id) AS tickets,
            (SELECT count(*)::int FROM tickets WHERE festival_id = f.id AND user_id IS NOT NULL) AS gekoppelde_tickets,
            (SELECT count(*)::int FROM festival_members WHERE festival_id = f.id) AS personeel,
            (SELECT count(*)::int FROM announcements WHERE festival_id = f.id) AS mededelingen,
            (SELECT count(*)::int FROM map_points WHERE festival_id = f.id) AS kaartpunten,
            (SELECT count(*)::int FROM pins WHERE festival_id = f.id) AS pins,
            (SELECT count(*)::int FROM sos_alerts WHERE festival_id = f.id) AS sos_meldingen
       FROM festivals f WHERE f.id = $1`,
    [id],
  )
  return rows[0] ?? null
}

export async function removeOldFestival(databaseUrl: string, sure: boolean, log = console.log): Promise<void> {
  await withClient(databaseUrl, async (client) => {
    const old = await contents(client, OLD_FESTIVAL)
    if (!old) {
      log('Het oude Testfestival bestaat niet (meer).')
      return
    }
    log(`Bij "${String(old.name)}" (het oude Testfestival) staat:`)
    for (const [key, value] of Object.entries(old)) if (key !== 'name') log(`  ${key.replace('_', ' ')}: ${value}`)
    const replacement = await client.query('SELECT 1 FROM festivals WHERE id = $1', [TEST_FESTIVAL])
    if (!replacement.rowCount) {
      throw new Error(`Maak eerst ${FESTIVAL_NAME} aan (--toevoegen), anders neemt het personeel zijn rol niet mee.`)
    }
    if (!sure) {
      log('')
      log('Dit gaat allemaal weg en kan niet ongedaan worden gemaakt (alleen met een back-up).')
      log('Accounts, vrienden en chats blijven. Bezoekers voeren daarna een nieuwe ticketcode in.')
      log('Echt verwijderen: voeg --zeker toe.')
      return
    }
    await deleteFestival(client, OLD_FESTIVAL)
    log('Het oude Testfestival is verwijderd.')
  })
}

export async function removeTestFestival(databaseUrl: string, log = console.log): Promise<void> {
  await withClient(databaseUrl, async (client) => {
    const current = await contents(client, TEST_FESTIVAL)
    if (!current) {
      log(`${FESTIVAL_NAME} bestaat niet (meer).`)
      return
    }
    await deleteFestival(client, TEST_FESTIVAL)
    log(`${FESTIVAL_NAME} is verwijderd, met ${current.optredens} optredens en ${current.tickets} tickets.`)
  })
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { databaseUrl } = loadConfig()
  const args = process.argv.slice(2)
  const run = args.includes('--toevoegen')
    ? addTestFestival(databaseUrl).then(() => undefined)
    : args.includes('--oud-verwijderen')
      ? removeOldFestival(databaseUrl, args.includes('--zeker'))
      : args.includes('--verwijderen')
        ? removeTestFestival(databaseUrl)
        : Promise.reject(new Error('Gebruik --toevoegen, --oud-verwijderen [--zeker] of --verwijderen'))
  run.catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  })
}
