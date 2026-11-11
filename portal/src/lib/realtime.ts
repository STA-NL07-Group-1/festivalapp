// WebSocket met automatisch opnieuw verbinden (met oplopende wachttijd).
import { API_URL, currentFestival, getAccessToken } from '../api/client'

type Listener = (data: unknown) => void

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
  let retry: ReturnType<typeof setTimeout> | undefined

  const setStatus = (online: boolean) => statusListeners.forEach((l) => l(online))

  async function open() {
    if (closed) return
    const token = await getAccessToken()
    if (!token || closed) return scheduleRetry()
    // API_URL kan absoluut zijn (http://localhost:3000) of relatief (/api achter de webserver)
    const base = new URL(API_URL, window.location.origin)
    base.protocol = base.protocol === 'https:' ? 'wss:' : 'ws:'
    // Alleen berichten van het gekozen festival
    const festival = currentFestival()
    const url = `${base.href.replace(/\/$/, '')}/ws?token=${encodeURIComponent(token)}${festival ? `&festival=${festival}` : ''}`
    socket = new WebSocket(url)
    socket.onopen = () => {
      attempt = 0
      setStatus(true)
      ping = setInterval(() => socket?.send(JSON.stringify({ type: 'ping' })), 25_000)
    }
    socket.onmessage = (event) => {
      try {
        const { type, data } = JSON.parse(String(event.data)) as { type: string; data: unknown }
        listeners.get(type)?.forEach((l) => l(data))
      } catch {
        /* ongeldig bericht negeren */
      }
    }
    socket.onclose = () => {
      clearInterval(ping)
      setStatus(false)
      scheduleRetry()
    }
  }

  function scheduleRetry() {
    if (closed) return
    const delay = Math.min(1000 * 2 ** attempt++, 30_000)
    retry = setTimeout(() => void open(), delay)
  }

  // Telefoon komt terug uit de slaapstand: meteen opnieuw proberen
  const onVisible = () => {
    if (document.visibilityState === 'visible' && socket?.readyState !== WebSocket.OPEN) {
      clearTimeout(retry)
      attempt = 0
      void open()
    }
  }
  document.addEventListener('visibilitychange', onVisible)

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
      clearInterval(ping)
      document.removeEventListener('visibilitychange', onVisible)
      socket?.close()
    },
  }
}
