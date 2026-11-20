// Wachtrij voor chatberichten en pins bij slecht bereik.
// Een bericht of pin staat eerst hier (op de telefoon, ook na het sluiten van de app) en gaat pas weg als de
// server het heeft. Elk item heeft een eigen clientId: komt het door een nieuwe poging twee keer bij de server,
// dan slaat de server het maar één keer op (zie POST /messages/:userId en POST /pins).
// De wachtrij staat bij de offline gegevens, zodat uitloggen hem ook wist.
import { useSyncExternalStore } from 'react'
import { api, ApiError, currentFestival, type Message, type Pin } from '../api/client'
import { loadOffline, saveOffline } from './offlineStore'

/** Chatbericht. Oude items van vóór de pins hebben nog geen `kind`: dat zijn ook berichten. */
export interface MessageItem {
  kind?: 'bericht'
  clientId: string
  friendId: string
  body: string
  createdAt: string
}

export interface PinItem {
  kind: 'pin'
  clientId: string
  /** Een pin hoort bij één festival; hij gaat pas weg als dat festival gekozen is */
  festivalId: string | null
  label: string
  latitude: number
  longitude: number
  visibility: Pin['visibility']
  createdAt: string
}

export type OutboxItem = MessageItem | PinItem

export const isPinItem = (item: OutboxItem): item is PinItem => item.kind === 'pin'
export const isMessageItem = (item: OutboxItem): item is MessageItem => item.kind !== 'pin'

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

export function enqueue(friendId: string, body: string): MessageItem {
  const item: MessageItem = { kind: 'bericht', clientId: crypto.randomUUID(), friendId, body, createdAt: new Date().toISOString() }
  write([...read(), item])
  return item
}

export function enqueuePin(pin: Pick<PinItem, 'label' | 'latitude' | 'longitude' | 'visibility'>): PinItem {
  const item: PinItem = { kind: 'pin', clientId: crypto.randomUUID(), festivalId: currentFestival(), ...pin, createdAt: new Date().toISOString() }
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
async function send<T>(item: OutboxItem, post: () => Promise<T>): Promise<T> {
  try {
    const result = await post()
    removeFromOutbox(item.clientId)
    return result
  } catch (error) {
    if (error instanceof ApiError && (error.status === 400 || error.status === 404)) removeFromOutbox(item.clientId)
    throw error
  }
}

export function deliver(item: MessageItem): Promise<Message> {
  return send(item, () => api.post<Message>(`/messages/${item.friendId}`, { body: item.body, clientId: item.clientId }))
}

export function deliverPin(item: PinItem): Promise<Pin> {
  const { label, latitude, longitude, visibility, clientId } = item
  return send(item, () => api.post<Pin>('/pins', { label, latitude, longitude, visibility, clientId }))
}

let flushing: Promise<void> | null = null

/** Probeert alles uit de wachtrij te versturen, op volgorde. Stopt bij de eerste fout (meestal: nog geen bereik). */
export function flushOutbox(): Promise<void> {
  // Let op: `flushing = null` moet ná het toewijzen gebeuren. Stond het in een `finally` binnen de async-functie,
  // dan liep dat al meteen (bij een lege wachtrij wordt er niets ge-await) en bleef `flushing` daarna voorgoed
  // gevuld met een afgeronde belofte. Dan werd de wachtrij nooit meer vanzelf verstuurd.
  flushing ??= (async () => {
    for (const item of read()) {
      if (isMessageItem(item)) await deliver(item)
      // Een pin van een ander festival wacht tot dat festival weer gekozen is
      else if (item.festivalId === currentFestival()) await deliverPin(item)
    }
  })()
    .catch(() => {
      /* later opnieuw */
    })
    .finally(() => {
      flushing = null
    })
  return flushing
}
