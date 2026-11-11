// Kleine opslag op de telefoon voor gegevens die je ook zonder internet wilt zien:
// podia, kaartpunten, je eigen account en de laatst bekende locaties van vrienden.
// Gegevens van één festival staan onder "<festival-id>:" (zie festivalKey), zodat ze
// weg kunnen als je geen toegang meer hebt tot dat festival.
// Alles staat onder één voorvoegsel, zodat uitloggen alles in één keer kan wissen.

const PREFIX = 'festivalapp.offline.'

/** Cache van de browser voor plattegronden: één afbeelding per festival */
export const SITE_MAP_CACHE = 'plattegronden-v1'
export const siteMapKey = (festivalId: string) => `/offline/plattegrond/${festivalId}`

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
  // Plattegronden staan in de cache van de browser (te groot voor localStorage)
  if (typeof caches !== 'undefined') void caches.delete(SITE_MAP_CACHE).catch(() => {})
  try {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith(PREFIX)) localStorage.removeItem(key)
    }
  } catch {
    /* niets */
  }
}

/** Sleutel voor gegevens die bij één festival horen */
export const festivalKey = (festivalId: string | null, key: string) => `${festivalId ?? 'geen'}:${key}`

/** Wist de bewaarde gegevens van één festival (bijv. als het is afgelopen). */
export function clearOfflineFestival(festivalId: string): void {
  if (typeof caches !== 'undefined') {
    void caches
      .open(SITE_MAP_CACHE)
      .then((cache) => cache.delete(siteMapKey(festivalId)))
      .catch(() => {})
  }
  try {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith(`${PREFIX}${festivalId}:`)) localStorage.removeItem(key)
    }
  } catch {
    /* niets */
  }
}
