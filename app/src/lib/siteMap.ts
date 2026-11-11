// De plattegrond van een festival, ook zonder internet.
// Een afbeelding is te groot voor localStorage; daarom bewaren we hem in de cache van de browser.
// Bij de afbeelding onthouden we wanneer hij is geüpload, zodat we alleen een nieuwe ophalen als die er is.
import { requestBlob } from '../api/client'
import { SITE_MAP_CACHE, siteMapKey } from './offlineStore'

const UPDATED_HEADER = 'X-Updated-At'

async function openCache(): Promise<Cache | null> {
  try {
    return typeof caches === 'undefined' ? null : await caches.open(SITE_MAP_CACHE)
  } catch {
    return null
  }
}

/**
 * Geeft een blob met de plattegrond, of null als het festival er geen heeft.
 * `updatedAt` komt uit /festival-info; is de bewaarde versie even oud, dan is ophalen niet nodig.
 * Zonder internet: de bewaarde versie, ook als die ouder is.
 */
export async function loadSiteMap(festivalId: string, updatedAt: string | null): Promise<{ blob: Blob; fromCache: boolean } | null> {
  if (!updatedAt) return null
  const cache = await openCache()
  const cached = await cache?.match(siteMapKey(festivalId))
  if (cached && cached.headers.get(UPDATED_HEADER) === updatedAt) return { blob: await cached.blob(), fromCache: true }
  try {
    const blob = await requestBlob('/site-map')
    await cache
      ?.put(siteMapKey(festivalId), new Response(blob, { headers: { 'Content-Type': blob.type, [UPDATED_HEADER]: updatedAt } }))
      .catch(() => {})
    return { blob, fromCache: false }
  } catch (error) {
    if (cached) return { blob: await cached.blob(), fromCache: true }
    throw error
  }
}
