// Alles rond het kiezen van een festival en het toevoegen van een ticket.
import { useState, type FormEvent } from 'react'
import { ApiError, type Festival } from '../api/client'
import { useI18n } from '../i18n'
import { formatDateRange } from '../lib/format'
import { useSession } from '../state/session'
import { Empty, ErrorNote, Screen, Sheet } from './ui'

/** Nu bezig, binnenkort of (alleen voor personeel) afgelopen */
export function FestivalStatus({ festival }: { festival: Festival }) {
  const { t } = useI18n()
  if (festival.active) return <span className="badge live">{t('festival.active')}</span>
  if (new Date(festival.endsAt).getTime() <= Date.now()) return <span className="badge">{t('festival.ended')}</span>
  return <span className="badge">{t('festival.upcoming')}</span>
}

/** Formulier om met een ticketcode een festival aan je account toe te voegen */
export function AddTicketForm({ onAdded }: { onAdded?: (festival: Festival | null) => void }) {
  const { t } = useI18n()
  const { addTicket, online } = useSession()
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    setBusy(true)
    try {
      const added = await addTicket(code)
      setCode('')
      onAdded?.(added)
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) setError(t('festivals.conflict'))
      else if (e instanceof ApiError && e.status === 429) setError(t('auth.rateLimited'))
      else if (e instanceof ApiError && e.status === 400) setError(t('festivals.invalid'))
      else setError(t('common.error'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="card form add-ticket" onSubmit={(e) => void submit(e)}>
      <h2>{t('festivals.addTicket')}</h2>
      <label>
        {t('auth.ticket')}
        <input
          value={code}
          onChange={(e) => setCode(e.target.value)}
          required
          minLength={8}
          maxLength={64}
          pattern="[A-Za-z0-9\-]+"
          autoCapitalize="characters"
          autoComplete="off"
          spellCheck={false}
          placeholder="DEMO-0001"
        />
      </label>
      <p className="muted small">{t('auth.ticketHint')}</p>
      {error && <ErrorNote>{error}</ErrorNote>}
      <button className="button primary" disabled={busy || !online}>
        {busy ? t('common.loading') : t('festivals.addTicket')}
      </button>
      {!online && <p className="muted small">{t('festivals.needsInternet')}</p>}
    </form>
  )
}

/** Lijst om een festival te kiezen. Gebruikt in de keuzebalk en bij Mijn festivals. */
export function FestivalList({ onChosen }: { onChosen?: () => void }) {
  const { t, locale } = useI18n()
  const { festivals, festival, chooseFestival, online } = useSession()
  const [error, setError] = useState(false)

  async function choose(id: string) {
    setError(false)
    try {
      if (id !== festival?.id) await chooseFestival(id)
      onChosen?.()
    } catch {
      setError(true)
    }
  }

  const ticketLabel = (type: string) =>
    type === 'vip' ? t('ticket.vip') : type === 'dag' ? t('ticket.dag') : type === 'weekend' ? t('ticket.weekend') : type

  if (festivals.length === 0) return <Empty>{t('festival.none.short')}</Empty>
  return (
    <>
      <ul className="list festivals">
        {festivals.map((f) => (
          <li key={f.id}>
            <button
              type="button"
              className="row"
              aria-pressed={f.id === festival?.id}
              // Zonder internet kun je niet wisselen: de gegevens van het andere festival zijn er niet
              disabled={!online && f.id !== festival?.id}
              onClick={() => void choose(f.id)}
            >
              <span className="emoji" aria-hidden="true">
                🎪
              </span>
              <span className="grow">
                <strong>{f.name}</strong>
                <span className="muted small">{formatDateRange(f.startsAt, f.endsAt, locale)}</span>
              </span>
              {f.ticketType && <span className={`badge ${f.ticketType === 'vip' ? 'vip' : ''}`}>{ticketLabel(f.ticketType)}</span>}
              <FestivalStatus festival={f} />
              {f.id === festival?.id && <span className="visually-hidden">{t('festivals.selected')}</span>}
            </button>
          </li>
        ))}
      </ul>
      {error && <ErrorNote>{t('common.error')}</ErrorNote>}
    </>
  )
}

/**
 * Balk boven de kaart, timetable en meldingen: bij welk festival kijk je?
 * Alleen zichtbaar als je bij meer dan één festival hoort; tik erop om te kiezen.
 */
export function FestivalBar() {
  const { t } = useI18n()
  const { festivals, festival } = useSession()
  const [open, setOpen] = useState(false)
  if (festivals.length < 2 || !festival) return null
  return (
    <>
      <button type="button" className="festival-bar" onClick={() => setOpen(true)} aria-haspopup="dialog">
        <span aria-hidden="true">🎪</span>
        <strong>{festival.name}</strong>
        <span className="festival-bar-action">{t('festival.switch')}</span>
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title={t('festival.choose')}>
        <FestivalList onChosen={() => setOpen(false)} />
      </Sheet>
    </>
  )
}

/** Wat je ziet op de kaart, timetable en meldingen als je nog bij geen enkel festival hoort */
export function NoFestivalScreen() {
  const { t } = useI18n()
  return (
    <Screen title={t('festival.none.title')}>
      <p className="muted">{t('festival.none.text')}</p>
      <AddTicketForm />
    </Screen>
  )
}
