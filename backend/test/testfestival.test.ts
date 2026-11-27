// De timetable van het testfestival (scripts/testfestival.ts), zonder database
import { describe, expect, it } from 'vitest'
import { buildTimetable, END_TIME, festivalDays, LAST_DAY } from '../scripts/testfestival.ts'

describe('timetable van het testfestival', () => {
  const days = festivalDays('2026-11-27')
  const timetable = buildTimetable(days)

  it('elke dag van vandaag tot en met 9 december heeft optredens', () => {
    expect(days[0]).toBe('2026-11-27')
    expect(days.at(-1)).toBe(LAST_DAY)
    expect(days).toHaveLength(13)
    for (const day of days) expect(timetable.filter((p) => p.startsAt.startsWith(day)).length).toBeGreaterThan(10)
  })

  it('niets eindigt na 23:00, en op de laatste dag niet na 22:00', () => {
    for (const p of timetable) {
      expect(p.endsAt > p.startsAt).toBe(true)
      const closing = p.startsAt.startsWith(LAST_DAY) ? END_TIME : '23:00'
      // Tijden als tekst ('20:50'): vergelijken met <= werkt omdat ze altijd twee cijfers hebben
      expect(p.endsAt.slice(11) <= closing).toBe(true)
    }
  })

  it('optredens op hetzelfde podium overlappen niet', () => {
    const sorted = [...timetable].sort((a, b) => (a.stage + a.startsAt).localeCompare(b.stage + b.startsAt))
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i]!.stage === sorted[i - 1]!.stage) expect(sorted[i]!.startsAt >= sorted[i - 1]!.endsAt).toBe(true)
    }
  })

  it('er zitten workshops met aanmelding en een paar gewijzigde optredens tussen', () => {
    expect(timetable.some((p) => p.signupCapacity === 30)).toBe(true)
    expect(new Set(timetable.map((p) => p.status))).toEqual(new Set(['gepland', 'vertraagd', 'verplaatst', 'geannuleerd']))
  })
})
