// Kleine opslag op de telefoon voor gegevens die je ook zonder internet wilt zien:
// podia, kaartpunten, je eigen account en de laatst bekende locaties van vrienden.
// Alles staat onder één voorvoegsel, zodat uitloggen alles in één keer kan wissen.

const PREFIX = 'festivalapp.offline.'

export interface Stored<T> {
  data: T
  /** Moment waarop de gegevens van de server kwamen (ISO) */
  savedAt: string
}

export function saveOffline<T>(key: string, data: T): void {
  try {
    const entry: Stored<T> = { data, savedAt: new Date().toISOString() }
    localStorage.setItem(PREFIX + key, JSON.stringify(entry))
  } catch {
    // privémodus of opslag vol: dan werkt de app alleen online
  }
}

export function loadOffline<T>(key: string): Stored<T> | null {
  try {
    const raw = localStorage.getItem(PREFIX + key)
    if (!raw) return null
    const entry = JSON.parse(raw) as Stored<T>
    return entry && typeof entry.savedAt === 'string' ? entry : null
  } catch {
    return null
  }
}

/** Wist alles wat offline is bewaard (bij uitloggen of account verwijderen). */
export function clearOffline(): void {
  try {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith(PREFIX)) localStorage.removeItem(key)
    }
  } catch {
    /* niets */
  }
}
