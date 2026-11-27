// WebSocket met automatisch opnieuw verbinden (met oplopende wachttijd).
// Een verbinding kan ook "half open" blijven hangen, bijvoorbeeld bij wisselen van wifi naar 4G:
// de telefoon denkt dat hij verbonden is, maar er komt niets meer binnen. Daarom houden we bij
// wanneer er voor het laatst iets binnenkwam en verbinden we zelf opnieuw als dat te lang geleden is.
// We laten de server ook weten of de app in beeld is: alleen dan slaat hij de pushmelding over
// (de app laat het bericht dan zelf zien). Op de achtergrond kan de verbinding nog even openstaan.
import { API_URL, api, currentFestival } from '../api/client'

type Listener = (data: unknown) => void

/** Elke zoveel tijd een ping; de server antwoordt met een pong */
export const PING_EVERY_MS = 25_000
/** Zo lang niets binnengekregen (ook geen pong)? Dan is de verbinding dood. */
export const DEAD_AFTER_MS = 60_000
/** Zo lang mag verbinden duren; daarna opnieuw proberen */
export const CONNECT_TIMEOUT_MS = 15_000

export interface RealtimeConnection {
  on(type: string, listener: Listener): () => void
  onStatus(listener: (online: boolean) => void): () => void
  close(): void
}

export function connectRealtime(): RealtimeConnection {
  const listeners = new Map<string, Set<Listener>>()
  const statusListeners = new Set<(online: boolean) => void>()
  let socket: WebSocket | null = null
  let closed = false
  let attempt = 0
  let ping: ReturnType<typeof setInterval> | undefined
  let connectTimer: ReturnType<typeof setTimeout> | undefined
  let retry: ReturnType<typeof setTimeout> | undefined
  let lastMessageAt = 0
  // Loopt er al een poging (ticket ophalen of verbinden)? Dan niet nog een starten.
  let opening = false

  const setStatus = (online: boolean) => statusListeners.forEach((l) => l(online))
  const sendVisibility = () => {
    if (socket?.readyState !== WebSocket.OPEN) return
    socket.send(JSON.stringify({ type: 'visibility', data: { visible: document.visibilityState === 'visible' } }))
  }
  const isDead = () => Date.now() - lastMessageAt > DEAD_AFTER_MS

  /** Huidige verbinding loslaten en opnieuw proberen. De handlers gaan eraf, zodat een late onclose niets meer doet. */
  function drop() {
    clearInterval(ping)
    clearTimeout(connectTimer)
    opening = false
    if (socket) {
      socket.onopen = null
      socket.onmessage = null
      socket.onclose = null
      socket.close()
      socket = null
    }
    setStatus(false)
  }

  async function open() {
    if (closed || opening) return
    opening = true
    // Eerst een eenmalig ticket ophalen: zo staat het access-token niet in de WebSocket-URL (en dus niet in logs)
    let ticket: string
    try {
      ticket = (await api.post<{ ticket: string; expiresIn: number }>('/realtime/ticket')).ticket
    } catch {
      opening = false
      return scheduleRetry()
    }
    if (closed) return
    // API_URL kan absoluut zijn (http://localhost:3000) of relatief (/api achter de webserver)
    const base = new URL(API_URL, window.location.origin)
    base.protocol = base.protocol === 'https:' ? 'wss:' : 'ws:'
    // Alleen berichten van het gekozen festival (chat en vrienden komen altijd binnen)
    const festival = currentFestival()
    const url = `${base.href.replace(/\/$/, '')}/ws?ticket=${encodeURIComponent(ticket)}${festival ? `&festival=${festival}` : ''}`
    const ws = new WebSocket(url)
    socket = ws
    connectTimer = setTimeout(() => {
      drop()
      scheduleRetry()
    }, CONNECT_TIMEOUT_MS)
    ws.onopen = () => {
      clearTimeout(connectTimer)
      opening = false
      attempt = 0
      lastMessageAt = Date.now()
      setStatus(true)
      sendVisibility()
      ping = setInterval(() => {
        if (isDead()) {
          drop()
          return scheduleRetry()
        }
        ws.send(JSON.stringify({ type: 'ping' }))
      }, PING_EVERY_MS)
    }
    ws.onmessage = (event) => {
      lastMessageAt = Date.now()
      try {
        const { type, data } = JSON.parse(String(event.data)) as { type: string; data: unknown }
        listeners.get(type)?.forEach((l) => l(data))
      } catch {
        /* ongeldig bericht negeren */
      }
    }
    ws.onclose = () => {
      opening = false
      socket = null
      clearInterval(ping)
      clearTimeout(connectTimer)
      setStatus(false)
      scheduleRetry()
    }
  }

  function scheduleRetry() {
    if (closed) return
    const delay = Math.min(1000 * 2 ** attempt++, 30_000)
    retry = setTimeout(() => void open(), delay)
  }

  // Telefoon komt terug uit de slaapstand: meteen opnieuw proberen als de verbinding weg of dood is
  const onVisible = () => {
    // Naar de achtergrond of weer terug: altijd even aan de server laten weten
    sendVisibility()
    if (document.visibilityState !== 'visible') return
    const healthy = socket?.readyState === WebSocket.OPEN && !isDead()
    if (healthy || opening) return
    if (socket) drop()
    clearTimeout(retry)
    attempt = 0
    void open()
  }
  document.addEventListener('visibilitychange', onVisible)
  // iPhone: bij het wegvegen van de app komt niet altijd een visibilitychange
  window.addEventListener('pagehide', sendVisibility)

  void open()

  return {
    on(type, listener) {
      if (!listeners.has(type)) listeners.set(type, new Set())
      listeners.get(type)!.add(listener)
      return () => listeners.get(type)?.delete(listener)
    },
    onStatus(listener) {
      statusListeners.add(listener)
      return () => statusListeners.delete(listener)
    },
    close() {
      closed = true
      clearTimeout(retry)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('pagehide', sendVisibility)
      drop()
    },
  }
}
