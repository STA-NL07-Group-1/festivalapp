// Gesprekken dempen: een groep (group_members.muted_until) of een vriend (chat_mutes), zie migratie 0012.
// Gedempt = geen pushmelding van dat gesprek. Berichten komen gewoon binnen en tellen mee als ongelezen.

/** "Altijd dempen" slaan we op als een datum ver weg, zodat het overal een gewone datum blijft */
export const MUTE_FOREVER = new Date('9999-12-31T00:00:00Z')

export type MuteDuration = '1h' | '24h' | 'always' | 'off'

const HOUR = 3_600_000

/** Tot wanneer het gesprek gedempt is; null = niet meer gedempt */
export function muteUntil(duration: MuteDuration, now = new Date()): Date | null {
  switch (duration) {
    case '1h':
      return new Date(now.getTime() + HOUR)
    case '24h':
      return new Date(now.getTime() + 24 * HOUR)
    case 'always':
      return MUTE_FOREVER
    case 'off':
      return null
  }
}

/** Voor de API: alleen een tijdstip als het dempen nog loopt */
export function mutedUntilJson(until: Date | null | undefined, now = new Date()): string | null {
  return until && until > now ? until.toISOString() : null
}
