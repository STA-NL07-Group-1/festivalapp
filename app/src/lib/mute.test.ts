import { describe, expect, it } from 'vitest'
import { translate } from '../i18n/translate'
import { isMuted, isMutedForever, muteLabel } from './mute'

const t = (key: Parameters<typeof translate>[1], vars?: Record<string, string | number>) => translate('nl', key, vars)

describe('dempen', () => {
  it('een tijdstip in het verleden telt niet meer als gedempt', () => {
    const now = Date.parse('2026-06-20T12:00:00Z')
    expect(isMuted(null, now)).toBe(false)
    expect(isMuted('2026-06-20T11:59:00Z', now)).toBe(false)
    expect(isMuted('2026-06-20T13:00:00Z', now)).toBe(true)
  })

  it('"altijd" is het jaar 9999', () => {
    expect(isMutedForever('9999-12-31T00:00:00.000Z')).toBe(true)
    expect(isMutedForever('2026-06-21T12:00:00Z')).toBe(false)
    expect(muteLabel('9999-12-31T00:00:00.000Z', t, 'nl')).toBe('Gedempt')
  })

  it('laat zien tot wanneer een gesprek gedempt is', () => {
    expect(muteLabel(null, t, 'nl')).toBeNull()
    const inAnHour = new Date(Date.now() + 3_600_000).toISOString()
    expect(muteLabel(inAnHour, t, 'nl')).toMatch(/^Gedempt tot .*\d{2}:\d{2}$/)
  })
})
