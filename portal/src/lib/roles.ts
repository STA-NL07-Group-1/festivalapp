import type { FestivalRole, Me } from '../api/client'

export const ROLE_LABEL: Record<Me['role'], string> = {
  bezoeker: 'Bezoeker',
  beheerder: 'Beheerder',
  organisatie: 'Organisatie',
  ehbo: 'EHBO',
  beveiliging: 'Beveiliging',
}

export const FESTIVAL_ROLES: FestivalRole[] = ['beheerder', 'organisatie', 'ehbo', 'beveiliging']

/**
 * Welke rollen mag deze gebruiker uitdelen? De backend controleert dit ook;
 * hier gebruiken we het alleen om de juiste keuzes te tonen.
 * Beheerder: alleen sudo. Organisatie: een beheerder. EHBO en beveiliging: ook de organisatie.
 */
export function assignableRoles(me: Me): FestivalRole[] {
  return FESTIVAL_ROLES.filter((role) => {
    if (role === 'beheerder') return me.platformRole === 'sudo'
    if (role === 'organisatie') return me.role === 'beheerder'
    return me.role === 'beheerder' || me.role === 'organisatie'
  })
}

/** Wat er onderaan het menu achter je naam staat */
export function roleText(me: Me): string {
  if (me.platformRole === 'sudo') return 'sudo'
  if (me.platformRole === 'eigenaar') return 'eigenaar'
  return ROLE_LABEL[me.role].toLowerCase()
}
