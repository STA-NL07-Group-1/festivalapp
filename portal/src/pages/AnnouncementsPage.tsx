import { useState, type FormEvent } from 'react'
import { api, ApiError, type Announcement } from '../api/client'
import { formatDateTime } from '../lib/realtimeContext'
import { useAsync } from '../lib/useAsync'

type Level = Announcement['level']

const LEVELS: { value: Level; label: string; hint: string }[] = [
  { value: 'info', label: 'Info', hint: 'Alleen in de app, geen pushmelding.' },
  { value: 'waarschuwing', label: 'Waarschuwing', hint: 'In de app én als pushmelding.' },
  { value: 'nood', label: 'Noodbericht', hint: 'Bovenaan in rood bij iedereen, pushmelding met hoge prioriteit.' },
]

/** Eén mededeling in beide talen: bezoekers zien de taal waarin hun app staat */
function BothLanguages({ a }: { a: Announcement }) {
  return (
    <div className="both-languages">
      <div>
        <span className="lang">NL</span>
        <strong>{a.titleNl}</strong>
        <p>{a.bodyNl}</p>
      </div>
      <div>
        <span className="lang">EN</span>
        <strong>{a.titleEn}</strong>
        <p>{a.bodyEn}</p>
      </div>
    </div>
  )
}

export function AnnouncementsPage() {
  const list = useAsync(() => api.get<Announcement[]>('/announcements'))
  const [level, setLevel] = useState<Level>('info')
  const [error, setError] = useState<string | null>(null)
  // De laatst verstuurde mededeling, met de vertaling die de server maakte
  const [sent, setSent] = useState<Announcement | null>(null)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const formElement = event.currentTarget
    const form = new FormData(formElement)
    const value = (name: string) => String(form.get(name) ?? '').trim()
    if (level === 'nood' && !window.confirm('Dit noodbericht gaat direct naar ALLE bezoekers. Doorgaan?')) return
    setError(null)
    setSent(null)
    try {
      // Eén titel en tekst: de server herkent de taal en vertaalt naar de andere
      const body: Record<string, string> = { level, title: value('title'), body: value('body') }
      const expires = value('expiresAt')
      if (expires) body.expiresAt = new Date(expires).toISOString()
      const created = await api.post<Announcement>('/admin/announcements', body)
      list.setData((items) => [created, ...(items ?? [])])
      formElement.reset()
      setLevel('info')
      setSent(created)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Versturen mislukt.')
    }
  }

  return (
    <section>
      <header className="page-header">
        <h1>Mededelingen en noodberichten</h1>
      </header>
      <div className="two-columns">
        <form className="card form" onSubmit={(e) => void submit(e)}>
          <h2>Nieuwe mededeling</h2>
          <fieldset className="levels">
            <legend>Soort</legend>
            {LEVELS.map((l) => (
              <label key={l.value} className={`level ${l.value} ${level === l.value ? 'selected' : ''}`}>
                <input type="radio" name="level" value={l.value} checked={level === l.value} onChange={() => setLevel(l.value)} />
                <strong>{l.label}</strong>
                <small>{l.hint}</small>
              </label>
            ))}
          </fieldset>
          <p className="muted small">
            Schrijf in het Nederlands of het Engels. De taal wordt herkend en de mededeling wordt automatisch vertaald, zodat
            iedere bezoeker hem in de taal van zijn app krijgt.
          </p>
          <label>
            Titel
            <input name="title" required maxLength={120} />
          </label>
          <label>
            Tekst
            <textarea name="body" required maxLength={2000} rows={4} />
          </label>
          <label>
            Verloopt op (optioneel)
            <input name="expiresAt" type="datetime-local" />
          </label>
          {error && <p className="error">{error}</p>}
          {sent && (
            <div role="status">
              <p className="success">Verstuurd ✓</p>
              {sent.translationFailed ? (
                <p className="warning">Vertalen lukte niet. De mededeling is in de originele taal verstuurd, ook naar Engelstalige bezoekers.</p>
              ) : (
                <BothLanguages a={sent} />
              )}
            </div>
          )}
          <button className={`button ${level === 'nood' ? 'danger' : 'primary'}`}>
            {level === 'nood' ? '⚠️ Noodbericht versturen' : 'Versturen'}
          </button>
        </form>

        <div>
          <h2>Actueel</h2>
          <ul className="list">
            {list.data?.map((a) => (
              <li key={a.id} className={`card announcement ${a.level}`}>
                <header>
                  <span className={`badge ${a.level}`}>{LEVELS.find((l) => l.value === a.level)?.label}</span>
                  <time className="muted">{formatDateTime(a.createdAt)}</time>
                </header>
                <BothLanguages a={a} />
              </li>
            ))}
          </ul>
          {list.data?.length === 0 && <p className="empty">Nog geen mededelingen.</p>}
        </div>
      </div>
    </section>
  )
}
