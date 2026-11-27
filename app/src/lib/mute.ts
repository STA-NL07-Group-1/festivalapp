// Dempen van een gesprek (vriend of groep), zie PUT /friends/:id/mute en PUT /groups/:id/mute.
// Gedempt = geen pushmelding en geen melding in de app; berichten komen gewoon binnen.
import { api } from '../api/client'
import type { Translate } from '../i18n/translate'
import { festivalDay, formatDay, formatTime, type Locale } from './format'

export type MuteDuration = '1h' | '24h' | 'always' | 'off'
export type MuteTarget = { friendId: string } | { groupId: string }

/** Nog gedempt? Een tijdstip in het verleden telt niet meer. */
export const isMuted = (until: string | null | undefined, now = Date.now()) => !!until && Date.parse(until) > now

/** "Altijd" slaat de server op als het jaar 9999 */
export const isMutedForever = (until: string | null | undefined) => !!until && new Date(until).getUTCFullYear() >= 9999

export async function setMute(target: MuteTarget, duration: MuteDuration): Promise<string | null> {
  const path = 'groupId' in target ? `/groups/${target.groupId}/mute` : `/friends/${target.friendId}/mute`
  return (await api.put<{ mutedUntil: string | null }>(path, { duration })).mutedUntil
}

/** "Gedempt", "Gedempt tot 15:30" of "Gedempt tot za 21 jun 15:30"; null = niet gedempt */
export function muteLabel(until: string | null | undefined, t: Translate, locale: Locale): string | null {
  if (!isMuted(until)) return null
  if (isMutedForever(until)) return t('mute.forever')
  const time = formatTime(until!, locale)
  const sameDay = festivalDay(until!) === festivalDay(new Date().toISOString())
  return t('mute.until', { time: sameDay ? time : `${formatDay(festivalDay(until!), locale)} ${time}` })
}
