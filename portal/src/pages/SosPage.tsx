import { useCallback } from 'react'
import { api, type SosAlert } from '../api/client'
import { formatDateTime, useRealtime } from '../lib/realtimeContext'
import { useAsync } from '../lib/useAsync'

const STATUS_LABEL: Record<SosAlert['status'], string> = {
  open: 'Open',
  in_behandeling: 'In behandeling',
  afgehandeld: 'Afgehandeld',
}

export function SosPage() {
  const alerts = useAsync(() => api.get<SosAlert[]>('/admin/sos'))
  const setAlerts = alerts.setData

  useRealtime<SosAlert>(
    'sos.update',
    useCallback(
      (alert) => {
        setAlerts((list) => [alert, ...(list ?? []).filter((a) => a.id !== alert.id)])
        if (alert.status === 'open') {
          // Geluidje in de browser van de meldkamer
          try {
            const ctx = new AudioContext()
            const osc = ctx.createOscillator()
            osc.frequency.value = 880
            osc.connect(ctx.destination)
            osc.start()
            osc.stop(ctx.currentTime + 0.3)
          } catch {
            /* geen geluid mogelijk */
          }
        }
      },
      [setAlerts],
    ),
  )

  async function setStatus(alert: SosAlert, status: SosAlert['status']) {
    const updated = await api.patch<SosAlert>(`/admin/sos/${alert.id}`, { status })
    setAlerts((list) => list?.map((a) => (a.id === updated.id ? updated : a)))
  }

  const sorted = [...(alerts.data ?? [])].sort((a, b) => {
    const rank = { open: 0, in_behandeling: 1, afgehandeld: 2 }
    return rank[a.status] - rank[b.status] || a.createdAt.localeCompare(b.createdAt)
  })

  return (
    <section>
      <header className="page-header">
        <h1>SOS-meldingen</h1>
        <p className="muted">Nieuwe meldingen verschijnen direct. Bij levensgevaar: schakel 112 in.</p>
      </header>
      {alerts.error ? <p className="error">Kon meldingen niet laden.</p> : null}
      {sorted.length === 0 && !alerts.loading && <p className="empty">Geen openstaande meldingen. 🎉</p>}
      <div className="cards">
        {sorted.map((a) => (
          <article key={a.id} className={`card sos ${a.status}`}>
            <header>
              <span className={`badge ${a.status}`}>{STATUS_LABEL[a.status]}</span>
              <time dateTime={a.createdAt}>{formatDateTime(a.createdAt)}</time>
            </header>
            {/* Platte tekst van de bezoeker: React escapet dit */}
            <p className="message">{a.message ?? <em className="muted">Geen bericht</em>}</p>
            {a.latitude != null && a.longitude != null ? (
              <a
                className="link"
                href={`https://www.openstreetmap.org/?mlat=${a.latitude}&mlon=${a.longitude}#map=19/${a.latitude}/${a.longitude}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                📍 {a.latitude.toFixed(5)}, {a.longitude.toFixed(5)} — open kaart
              </a>
            ) : (
              <p className="muted">Geen locatie meegestuurd</p>
            )}
            <div className="actions">
              {a.status === 'open' && (
                <button type="button" className="button primary" onClick={() => void setStatus(a, 'in_behandeling')}>
                  Oppakken
                </button>
              )}
              {a.status !== 'afgehandeld' && (
                <button type="button" className="button" onClick={() => void setStatus(a, 'afgehandeld')}>
                  Afgehandeld
                </button>
              )}
              {a.status === 'afgehandeld' && (
                <button type="button" className="button" onClick={() => void setStatus(a, 'open')}>
                  Heropenen
                </button>
              )}
            </div>
          </article>
        ))}
      </div>
    </section>
  )
}
