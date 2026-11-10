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

export function AnnouncementsPage() {
  const list = useAsync(() => api.get<Announcement[]>('/announcements'))
  const [level, setLevel] = useState<Level>('info')
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState(false)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const formElement = event.currentTarget
    const form = new FormData(formElement)
    const value = (name: string) => String(form.get(name) ?? '').trim()
    if (level === 'nood' && !window.confirm('Dit noodbericht gaat direct naar ALLE bezoekers. Doorgaan?')) return
    setError(null)
    setSent(false)
    try {
      const body: Record<string, string> = {
        level,
        titleNl: value('titleNl'),
        titleEn: value('titleEn'),
        bodyNl: value('bodyNl'),
        bodyEn: value('bodyEn'),
      }
      const expires = value('expiresAt')
      if (expires) body.expiresAt = new Date(expires).toISOString()
      const created = await api.post<Announcement>('/admin/announcements', body)
      list.setData((items) => [created, ...(items ?? [])])
      formElement.reset()
      setLevel('info')
      setSent(true)
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
          <div className="grid-2">
            <label>
              Titel (NL)
              <input name="titleNl" required maxLength={120} />
            </label>
            <label>
              Title (EN)
              <input name="titleEn" required maxLength={120} />
            </label>
            <label>
              Tekst (NL)
              <textarea name="bodyNl" required maxLength={2000} rows={4} />
            </label>
            <label>
              Text (EN)
              <textarea name="bodyEn" required maxLength={2000} rows={4} />
            </label>
          </div>
          <label>
            Verloopt op (optioneel)
            <input name="expiresAt" type="datetime-local" />
          </label>
          {error && <p className="error">{error}</p>}
          {sent && <p className="success">Verstuurd ✓</p>}
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
                <strong>{a.titleNl}</strong>
                <p>{a.bodyNl}</p>
              </li>
            ))}
          </ul>
          {list.data?.length === 0 && <p className="empty">Nog geen mededelingen.</p>}
        </div>
      </div>
    </section>
  )
}
