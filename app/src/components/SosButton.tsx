// SOS-knop: 2 seconden ingedrukt houden, dan een bevestigingsscherm.
import { useCallback, useRef, useState, type FormEvent } from 'react'
import { api, ApiError, type SosAlert } from '../api/client'
import { useI18n } from '../i18n'
import { useRealtime } from '../state/session'
import { Sheet } from './ui'

const HOLD_MS = 2000

export function SosButton({ position }: { position: GeolocationCoordinates | null }) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const [holding, setHolding] = useState(false)
  const [alert, setAlert] = useState<SosAlert | null>(null)
  const [error, setError] = useState<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const start = () => {
    setHolding(true)
    timer.current = setTimeout(() => {
      setHolding(false)
      setOpen(true)
      navigator.vibrate?.(200)
    }, HOLD_MS)
  }
  const stop = () => {
    setHolding(false)
    clearTimeout(timer.current)
  }

  useRealtime<SosAlert>(
    'sos.update',
    useCallback((update) => setAlert((current) => (current && current.id === update.id ? update : current)), []),
  )

  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const message = String(new FormData(event.currentTarget).get('message') ?? '').trim()
    setError(null)
    try {
      const body: Record<string, unknown> = {}
      if (position) {
        body.latitude = position.latitude
        body.longitude = position.longitude
      }
      if (message) body.message = message
      setAlert(await api.post<SosAlert>('/sos', body))
    } catch (e) {
      setError(e instanceof ApiError && e.status === 0 ? t('common.offline') : t('common.error'))
    }
  }

  return (
    <>
      <button
        type="button"
        className={`fab sos ${holding ? 'holding' : ''}`}
        aria-label={`${t('sos.button')} — ${t('sos.hold')}`}
        title={t('sos.hold')}
        onPointerDown={start}
        onPointerUp={stop}
        onPointerLeave={stop}
        onContextMenu={(e) => e.preventDefault()}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') setOpen(true)
        }}
      >
        {t('sos.button')}
      </button>

      <Sheet open={open} onClose={() => setOpen(false)} title={t('sos.title')}>
        <a className="button danger block" href="tel:112">
          📞 {t('sos.call112')}
        </a>
        {alert ? (
          <div className="sos-status" role="status">
            <p>{t('sos.sent')}</p>
            <p>
              <strong>{t(`sos.status.${alert.status}`)}</strong>
            </p>
          </div>
        ) : (
          <form className="form" onSubmit={(e) => void send(e)}>
            <p className="muted">{t('sos.explain')}</p>
            <label>
              {t('sos.message')}
              <textarea name="message" maxLength={500} rows={3} />
            </label>
            {error && <p className="error-note">{error}</p>}
            <button className="button danger">{t('sos.send')}</button>
          </form>
        )}
      </Sheet>
    </>
  )
}
