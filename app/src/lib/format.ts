export const FESTIVAL_TZ = (import.meta.env.VITE_FESTIVAL_TZ as string | undefined) ?? 'Europe/Amsterdam'

export type Locale = 'nl' | 'en'
const tag = (locale: Locale) => (locale === 'nl' ? 'nl-NL' : 'en-GB')

export function formatTime(iso: string, locale: Locale): string {
  return new Intl.DateTimeFormat(tag(locale), { hour: '2-digit', minute: '2-digit', timeZone: FESTIVAL_TZ }).format(new Date(iso))
}

/** YYYY-MM-DD in de tijdzone van het festival */
export function festivalDay(iso: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: FESTIVAL_TZ }).format(new Date(iso))
}

export function formatDay(day: string, locale: Locale): string {
  // 12:00 UTC valt in elke Europese tijdzone op dezelfde dag
  return new Intl.DateTimeFormat(tag(locale), { weekday: 'short', day: 'numeric', month: 'short', timeZone: FESTIVAL_TZ }).format(
    new Date(`${day}T12:00:00Z`),
  )
}

/** "za 20 jun – ma 22 jun", of één dag als begin en eind op dezelfde dag vallen */
export function formatDateRange(startIso: string, endIso: string, locale: Locale): string {
  const start = festivalDay(startIso)
  const end = festivalDay(endIso)
  return start === end ? formatDay(start, locale) : `${formatDay(start, locale)} – ${formatDay(end, locale)}`
}

export function formatRelative(iso: string, locale: Locale, now = Date.now()): string {
  const seconds = Math.round((new Date(iso).getTime() - now) / 1000)
  const rtf = new Intl.RelativeTimeFormat(tag(locale), { numeric: 'auto' })
  const abs = Math.abs(seconds)
  if (abs < 60) return rtf.format(seconds, 'second')
  if (abs < 3600) return rtf.format(Math.round(seconds / 60), 'minute')
  if (abs < 86400) return rtf.format(Math.round(seconds / 3600), 'hour')
  return rtf.format(Math.round(seconds / 86400), 'day')
}

/** Afstand in meters tussen twee coördinaten (haversine) */
export function distanceM(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }): number {
  const R = 6_371_000
  const rad = (d: number) => (d * Math.PI) / 180
  const dLat = rad(b.latitude - a.latitude)
  const dLng = rad(b.longitude - a.longitude)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

export const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('')
