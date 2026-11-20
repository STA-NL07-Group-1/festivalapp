// Systeemregel in een groepschat ("Anna heeft Bram toegevoegd") als zin in de taal van de app
import type { SystemEvent } from '../api/client'
import type { Translate as TFunction } from '../i18n/translate'

/** Systeemregel als zin, vanuit jou gezien ("Jij hebt Bram toegevoegd") */
export function systemText(event: SystemEvent, meId: string | null, t: TFunction): string {
  // "door jou" / "by you": in een zin met "door" het voorwerp, niet "jij"
  const name = (person: { id: string; name: string }) => (person.id === meId ? t('chat.youObject') : person.name)
  const actor = name(event.actor)
  const targets = event.targets.map(name).join(', ')
  switch (event.type) {
    case 'aangemaakt':
      return t('group.event.created', { actor, name: event.value ?? '' })
    case 'toegevoegd':
      return t('group.event.added', { actor, targets })
    case 'verwijderd':
      return t('group.event.removed', { actor, targets })
    case 'verlaten':
      return event.actor.id === meId ? t('group.event.leftMe') : t('group.event.left', { actor })
    case 'naam':
      return t('group.event.renamed', { actor, name: event.value ?? '' })
  }
}
