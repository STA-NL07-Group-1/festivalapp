// Een gesprek dempen: 1 uur, 24 uur, altijd, of weer aanzetten.
// MuteSheet opent als je een gesprek ingedrukt houdt (lijst met vrienden en groepen).
// MuteOptions staat in het profiel van een vriend en in de groepsinfo.
import { useState } from 'react'
import { useI18n } from '../i18n'
import { isMuted, muteLabel, setMute, type MuteDuration, type MuteTarget } from '../lib/mute'
import { BellOffIcon } from './icons'
import { ErrorNote, Sheet } from './ui'

const DURATIONS: Exclude<MuteDuration, 'off'>[] = ['1h', '24h', 'always']

interface MuteProps {
  target: MuteTarget | null
  name: string
  mutedUntil: string | null | undefined
  /** Na opslaan: het nieuwe tijdstip (null = niet gedempt) */
  onChanged: (mutedUntil: string | null) => void
}

function MuteChoices({ target, name, mutedUntil, onChanged, onDone, inline }: MuteProps & { onDone?: () => void; inline?: boolean }) {
  const { t, locale } = useI18n()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(false)
  const label = muteLabel(mutedUntil, t, locale)

  async function choose(duration: MuteDuration) {
    if (!target) return
    setBusy(true)
    setError(false)
    try {
      onChanged(await setMute(target, duration))
      onDone?.()
    } catch {
      setError(true)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="stack">
      {/* In het profiel staat de stand al in de regel erboven */}
      {!(inline && label) && <p className="muted">{label ?? t('mute.hint', { name })}</p>}
      <div className="mute-options">
        {DURATIONS.map((d) => (
          <button key={d} type="button" className="button" disabled={busy} onClick={() => void choose(d)}>
            {t(`mute.${d}`)}
          </button>
        ))}
      </div>
      {isMuted(mutedUntil) && (
        <button type="button" className="button primary" disabled={busy} onClick={() => void choose('off')}>
          {t('mute.off')}
        </button>
      )}
      {error && <ErrorNote>{t('common.error')}</ErrorNote>}
    </div>
  )
}

export function MuteSheet({ open, onClose, ...props }: MuteProps & { open: boolean; onClose: () => void }) {
  const { t } = useI18n()
  return (
    <Sheet open={open} onClose={onClose} title={`${t('mute.title')}: ${props.name}`}>
      <MuteChoices {...props} onDone={onClose} />
    </Sheet>
  )
}

/** In het profiel of de groepsinfo: één regel met de huidige stand; tik om de keuzes te zien */
export function MuteOptions(props: MuteProps) {
  const { t, locale } = useI18n()
  const [open, setOpen] = useState(false)
  const label = muteLabel(props.mutedUntil, t, locale)
  return (
    <section className="mute-section">
      <button type="button" className="row" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <BellOffIcon />
        <span className="grow">
          <strong>{t('mute.title')}</strong>
          {label && <span className="muted small">{label}</span>}
        </span>
      </button>
      {open && <MuteChoices {...props} inline onDone={() => setOpen(false)} />}
    </section>
  )
}
