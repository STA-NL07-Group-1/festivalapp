// Aantal ongelezen chatberichten (vrienden en groepen samen): voor het getal op het app-icoon
// (navigator.setAppBadge) en bij het tabblad Vrienden. De server telt (GET /me/unread), zodat het
// getal op al je apparaten klopt. Gedempte gesprekken tellen mee, net als bij WhatsApp.
// Als de app dicht is, zet de service worker het getal bij elke pushmelding (zie sw.ts).
import { useSyncExternalStore } from 'react'
import { api } from '../api/client'

let total = 0
const listeners = new Set<() => void>()
let timer: ReturnType<typeof setTimeout> | undefined

/** Getal op het app-icoon. Niet elke browser kan dit (o.a. Firefox niet); dan gebeurt er niets. */
export function applyBadge(count: number): void {
  if (!('setAppBadge' in navigator)) return
  const done = count > 0 ? navigator.setAppBadge(count) : navigator.clearAppBadge()
  done.catch(() => {
    /* geen toestemming voor meldingen: dan ook geen getal */
  })
}

function set(count: number) {
  if (count === total) return
  total = count
  applyBadge(count)
  listeners.forEach((listener) => listener())
}

/**
 * Opnieuw ophalen. Een halve seconde wachten: komen er meerdere berichten tegelijk binnen, of wordt
 * een gesprek net als gelezen gemarkeerd, dan is dat samen één verzoek.
 */
export function refreshUnread(): void {
  clearTimeout(timer)
  timer = setTimeout(() => {
    api
      .get<{ total: number }>('/me/unread')
      .then((r) => set(r.total))
      .catch(() => {
        /* geen bereik: het oude getal laten staan */
      })
  }, 500)
}

/** Uitloggen: getal weg */
export function resetUnread(): void {
  clearTimeout(timer)
  total = -1
  set(0)
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useUnreadTotal(): number {
  return useSyncExternalStore(subscribe, () => Math.max(total, 0))
}
