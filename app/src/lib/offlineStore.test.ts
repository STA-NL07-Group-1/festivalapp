import { describe, expect, it } from 'vitest'
import { clearOffline, clearOfflineFestival, festivalKey, loadOffline, saveOffline } from './offlineStore'

describe('offline opslag', () => {
  it('bewaart gegevens met het moment van opslaan', () => {
    saveOffline('stages', [{ id: 'a', name: 'Hoofdpodium' }])
    const stored = loadOffline<{ id: string; name: string }[]>('stages')
    expect(stored?.data).toEqual([{ id: 'a', name: 'Hoofdpodium' }])
    expect(Date.parse(stored!.savedAt)).not.toBeNaN()
  })

  it('geeft null als er niets is bewaard of de inhoud kapot is', () => {
    expect(loadOffline('bestaat-niet')).toBeNull()
    localStorage.setItem('festivalapp.offline.kapot', '{niet: geldig')
    expect(loadOffline('kapot')).toBeNull()
  })

  it('wist bij uitloggen alleen de offline gegevens', () => {
    saveOffline('me', { id: '1' })
    localStorage.setItem('festivalapp.locale', 'nl')
    clearOffline()
    expect(loadOffline('me')).toBeNull()
    expect(localStorage.getItem('festivalapp.locale')).toBe('nl')
  })

  it('wist alleen de gegevens van één festival', () => {
    saveOffline(festivalKey('fest-a', 'stages'), ['a'])
    saveOffline(festivalKey('fest-b', 'stages'), ['b'])
    saveOffline('me', { id: '1' })
    clearOfflineFestival('fest-a')
    expect(loadOffline(festivalKey('fest-a', 'stages'))).toBeNull()
    expect(loadOffline<string[]>(festivalKey('fest-b', 'stages'))?.data).toEqual(['b'])
    expect(loadOffline('me')).not.toBeNull()
  })
})
