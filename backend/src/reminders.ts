// Herinnering vlak voor een optreden: wie de act in zijn timetable heeft of zich ervoor heeft
// aangemeld, krijgt REMINDER_MINUTES van tevoren een pushmelding. server.ts roept dit elke minuut aan.
import type { Db } from './db.ts'
import type { Push } from './push.ts'

export const REMINDER_MINUTES = 15

interface DueReminder {
  user_id: string
  performance_id: string
  artist: string
  stage: string
  starts_at: Date
  signed_up: boolean
}

/** Stuurt alle herinneringen die nu aan de beurt zijn. Geeft terug hoeveel mensen er een kregen. */
export async function sendShowReminders(db: Db, push: Push, now = new Date()): Promise<number> {
  // Eén query die de herinneringen meteen als verstuurd markeert (UPDATE ... RETURNING).
  // Zo kan dezelfde herinnering nooit twee keer gaan, ook niet als dit per ongeluk dubbel draait.
  const { rows } = await db.query<DueReminder>(
    `WITH due AS (
       SELECT p.id, p.artist, s.name AS stage, p.starts_at
         FROM performances p JOIN stages s ON s.id = p.stage_id
        WHERE p.status <> 'geannuleerd'
          AND p.starts_at > $1 AND p.starts_at <= $1 + make_interval(mins => $2)
     ), entries AS (
       UPDATE timetable_entries t SET reminded_at = $1 FROM due
        WHERE t.performance_id = due.id AND t.reminded_at IS NULL
        RETURNING t.user_id, t.performance_id, false AS signup
     ), signups AS (
       UPDATE show_signups t SET reminded_at = $1 FROM due
        WHERE t.performance_id = due.id AND t.reminded_at IS NULL
        RETURNING t.user_id, t.performance_id, true AS signup
     )
     SELECT x.user_id, due.id AS performance_id, due.artist, due.stage, due.starts_at, bool_or(x.signup) AS signed_up
       FROM (SELECT * FROM entries UNION ALL SELECT * FROM signups) x
       JOIN due ON due.id = x.performance_id
      GROUP BY x.user_id, due.id, due.artist, due.stage, due.starts_at`,
    [now, REMINDER_MINUTES],
  )

  // Per optreden en per soort tekst één keer versturen
  const groups = new Map<string, { userIds: string[]; row: DueReminder }>()
  for (const row of rows) {
    const key = `${row.performance_id}:${row.signed_up}`
    const group = groups.get(key) ?? { userIds: [] as string[], row }
    group.userIds.push(row.user_id)
    groups.set(key, group)
  }
  for (const { userIds, row } of groups.values()) {
    // Minuten in plaats van een kloktijd: de server draait op UTC, de bezoeker niet
    const minutes = Math.max(1, Math.round((new Date(row.starts_at).getTime() - now.getTime()) / 60_000))
    await push.toUsers(
      userIds,
      {
        title: row.artist,
        body: `Begint over ${minutes} ${minutes === 1 ? 'minuut' : 'minuten'} bij ${row.stage}${row.signed_up ? '. Je bent aangemeld.' : ''}`,
        tag: `reminder-${row.performance_id}`,
        url: '/?tab=timetable',
      },
      'timetable',
    )
  }
  return rows.length
}
