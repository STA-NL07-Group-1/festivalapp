// Wachtrij voor chatberichten bij slecht bereik.
// Een bericht staat eerst hier (op de telefoon, ook na het sluiten van de app) en gaat pas weg als de server
// het heeft. Elk bericht heeft een eigen clientId: komt het door een nieuwe poging twee keer bij de server,
// dan slaat de server het maar één keer op (zie POST /messages/:userId).
// De wachtrij staat bij de offline gegevens, zodat uitloggen hem ook wist.
import { useSyncExternalStore } from 'react'
import { api, ApiError, type Message } from '../api/client'
import { loadOffline, saveOffline } from './offlineStore'

export interface OutboxItem {
  clientId: string
  friendId: string
  body: string
  createdAt: string
}

const KEY = 'outbox'
const listeners = new Set<() => void>()
const EMPTY: OutboxItem[] = []
// Zelfde lijst teruggeven zolang er niets veranderd is (nodig voor useSyncExternalStore)
let cache: { raw: string; items: OutboxItem[] } | null = null

function read(): OutboxItem[] {
  let raw = ''
  try {
    raw = localStorage.getItem(`festivalapp.offline.${KEY}`) ?? ''
  } catch {
    /* geen opslag: dan is de wachtrij leeg */
  }
  if (cache && cache.raw === raw) return cache.items
  const items = loadOffline<OutboxItem[]>(KEY)?.data ?? EMPTY
  cache = { raw, items }
  return items
}

function write(items: OutboxItem[]) {
  saveOffline(KEY, items)
  listeners.forEach((listener) => listener())
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Alle berichten die nog niet bij de server zijn */
export function useOutbox(): OutboxItem[] {
  return useSyncExternalStore(subscribe, read, () => EMPTY)
}

export function enqueue(friendId: string, body: string): OutboxItem {
  const item: OutboxItem = { clientId: crypto.randomUUID(), friendId, body, createdAt: new Date().toISOString() }
  write([...read(), item])
  return item
}

/** Haalt een bericht uit de wachtrij (aangekomen, of via de WebSocket al gezien) */
export function removeFromOutbox(clientId: string): void {
  const items = read()
  if (items.some((i) => i.clientId === clientId)) write(items.filter((i) => i.clientId !== clientId))
}

/**
 * Stuurt één bericht. Gelukt: uit de wachtrij. Weigert de server het voorgoed (bijv. geen vrienden meer
 * of ongeldig), dan gaat het ook uit de wachtrij. Bij geen bereik of een drukke server blijft het staan.
 */
export async function deliver(item: OutboxItem): Promise<Message> {
  try {
    const message = await api.post<Message>(`/messages/${item.friendId}`, { body: item.body, clientId: item.clientId })
    removeFromOutbox(item.clientId)
    return message
  } catch (error) {
    if (error instanceof ApiError && (error.status === 400 || error.status === 404)) removeFromOutbox(item.clientId)
    throw error
  }
}

let flushing: Promise<void> | null = null

/** Probeert alles uit de wachtrij te versturen, op volgorde. Stopt bij de eerste fout (meestal: nog geen bereik). */
export function flushOutbox(): Promise<void> {
  flushing ??= (async () => {
    try {
      for (const item of read()) await deliver(item)
    } catch {
      /* later opnieuw */
    } finally {
      flushing = null
    }
  })()
  return flushing
}
