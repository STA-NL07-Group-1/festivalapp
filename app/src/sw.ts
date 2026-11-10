/// <reference lib="webworker" />
// Service worker: app offline beschikbaar maken en pushmeldingen tonen.
// API-verzoeken worden NIET gecachet: locaties, chat en noodberichten moeten actueel zijn.
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching'
import { NavigationRoute, registerRoute } from 'workbox-routing'

declare const self: ServiceWorkerGlobalScope

precacheAndRoute(self.__WB_MANIFEST)
cleanupOutdatedCaches()
// Alle pagina's van de app → index.html (ook offline). Niet voor de API en het beheerportal.
registerRoute(new NavigationRoute(createHandlerBoundToURL('index.html'), { denylist: [/^\/api\//, /^\/beheer(\/|$)/] }))

// Kaarttegels bewaren die je al eens hebt bekeken, zodat de kaart van het terrein ook
// zonder internet zichtbaar blijft. We halen niets vooruit op: de kaartdiensten staan
// bulk-downloaden niet toe. Eerst uit de cache, anders van internet (en dan bewaren).
const TILE_CACHE = 'kaarttegels-v1'
const TILE_HOSTS = ['basemaps.cartocdn.com', 'tile.openstreetmap.org']
const MAX_TILES = 3000

const isTile = (url: URL) => TILE_HOSTS.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`))

async function trimTileCache(cache: Cache): Promise<void> {
  const keys = await cache.keys()
  // Oudste eerst weg (de cache onthoudt de volgorde waarin tegels zijn toegevoegd)
  for (const key of keys.slice(0, Math.max(0, keys.length - MAX_TILES))) await cache.delete(key)
}

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET' || !isTile(new URL(event.request.url))) return
  event.respondWith(
    (async () => {
      const cache = await caches.open(TILE_CACHE)
      const cached = await cache.match(event.request)
      if (cached) return cached
      const response = await fetch(event.request)
      // Tegels van een ander domein komen als "opaque" response (status 0); die mogen ook in de cache
      if (response.ok || response.type === 'opaque') {
        event.waitUntil(cache.put(event.request, response.clone()).then(() => trimTileCache(cache)))
      }
      return response
    })(),
  )
})

self.addEventListener('message', (event) => {
  if ((event.data as { type?: string } | null)?.type === 'SKIP_WAITING') void self.skipWaiting()
})

interface PushPayload {
  title: string
  body: string
  tag?: string
  url?: string
  urgent?: boolean
}

self.addEventListener('push', (event) => {
  let data: PushPayload = { title: 'Festivalapp', body: '' }
  try {
    data = { ...data, ...(event.data?.json() as PushPayload) }
  } catch {
    data.body = event.data?.text() ?? ''
  }
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      tag: data.tag,
      icon: '/pwa-192x192.png',
      badge: '/pwa-64x64.png',
      requireInteraction: data.urgent ?? false,
      data: { url: data.url ?? '/' },
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const raw = (event.notification.data as { url?: string } | null)?.url ?? '/'
  // Alleen paden binnen onze eigen app openen
  const target = new URL(raw, self.location.origin)
  const url = target.origin === self.location.origin ? target.href : self.location.origin
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      const existing = windows.find((w) => new URL(w.url).origin === self.location.origin)
      if (existing) {
        await existing.navigate(url)
        await existing.focus()
      } else {
        await self.clients.openWindow(url)
      }
    })(),
  )
})
