import { describe, expect, it } from 'vitest'
import type { Performance } from '../api/client'
import { extractFriendCode } from '../screens/FriendsScreen'
import { groupByDay } from '../screens/TimetableScreen'
import { distanceM, festivalDay, formatDateRange, formatDay, initials } from './format'

describe('vriendcodes uit QR of tekst', () => {
  it.each([
    ['K7QM-4XPA', 'K7QM-4XPA'],
    ['k7qm4xpa', 'K7QM-4XPA'],
    [' K7QM 4XPA ', 'K7QM-4XPA'],
    ['https://festival.example/?vriend=K7QM-4XPA', 'K7QM-4XPA'],
    ['https://evil.example/?x=1', null],
    ['te-kort', null],
    ['<script>', null],
  ])('%s → %s', (input, expected) => {
    expect(extractFriendCode(input)).toBe(expected)
  })
})

describe('formatteren', () => {
  it('festivaldag gebruikt de tijdzone van het festival', () => {
    // 23:30 UTC op 20 juni = 01:30 op 21 juni in Amsterdam (zomertijd)
    expect(festivalDay('2026-06-20T23:30:00Z')).toBe('2026-06-21')
  })

  it('periode van een festival: één dag of van–tot', () => {
    const day = festivalDay('2026-06-20T10:00:00Z')
    expect(formatDateRange('2026-06-20T10:00:00Z', '2026-06-20T20:00:00Z', 'nl')).toBe(formatDay(day, 'nl'))
    const range = formatDateRange('2026-06-20T10:00:00Z', '2026-06-22T20:00:00Z', 'nl')
    expect(range).toBe(`${formatDay(day, 'nl')} – ${formatDay('2026-06-22', 'nl')}`)
  })

  it('initialen', () => {
    expect(initials('anna de vries')).toBe('AD')
    expect(initials('Bram')).toBe('B')
  })

  it('afstand tussen twee punten', () => {
    const d = distanceM({ latitude: 52.0, longitude: 4.0 }, { latitude: 52.001, longitude: 4.0 })
    expect(d).toBeGreaterThan(105)
    expect(d).toBeLessThan(118)
  })
})

describe('timetable', () => {
  const p = (id: string, startsAt: string): Performance => ({
    id,
    stageId: 's',
    artist: id,
    startsAt,
    endsAt: startsAt,
    status: 'gepland',
  })

  it('groepeert per dag en sorteert op tijd', () => {
    const days = groupByDay([p('b', '2026-06-20T20:00:00Z'), p('a', '2026-06-20T14:00:00Z'), p('c', '2026-06-21T14:00:00Z')])
    expect([...days.keys()]).toEqual(['2026-06-20', '2026-06-21'])
    expect(days.get('2026-06-20')!.map((x) => x.id)).toEqual(['a', 'b'])
  })
})

describe('code of conduct en privacy policy', () => {
  it('Nederlands en Engels hebben dezelfde onderdelen', async () => {
    const { LEGAL } = await import('../content/legal')
    for (const text of Object.values(LEGAL)) {
      expect(text.en.sections.map((s) => s.paragraphs.length)).toEqual(text.nl.sections.map((s) => s.paragraphs.length))
    }
  })
})
