import { createContext, useContext, useEffect } from 'react'
import type { RealtimeConnection } from './realtime'

export const RealtimeContext = createContext<RealtimeConnection | null>(null)

/** Luister naar een realtime-event zolang het component bestaat. */
export function useRealtime<T>(type: string, handler: (data: T) => void): void {
  const realtime = useContext(RealtimeContext)
  useEffect(() => {
    if (!realtime) return
    return realtime.on(type, (data) => handler(data as T))
  }, [realtime, type, handler])
}

export const TZ = (import.meta.env.VITE_FESTIVAL_TZ as string | undefined) ?? 'Europe/Amsterdam'

export const formatDateTime = (iso: string) =>
  new Intl.DateTimeFormat('nl-NL', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: TZ }).format(
    new Date(iso),
  )

export const formatTime = (iso: string) =>
  new Intl.DateTimeFormat('nl-NL', { hour: '2-digit', minute: '2-digit', timeZone: TZ }).format(new Date(iso))

/** ISO → waarde voor <input type="datetime-local"> (in de lokale tijd van de browser) */
export function toLocalInput(iso: string): string {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}
