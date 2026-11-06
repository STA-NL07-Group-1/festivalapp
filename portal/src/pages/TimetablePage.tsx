import { useState, type FormEvent } from 'react'
import { api, ApiError, type Performance, type Stage } from '../api/client'
import { formatDateTime, formatTime, toLocalInput } from '../lib/realtimeContext'
import { useAsync } from '../lib/useAsync'

const STATUSES: Performance['status'][] = ['gepland', 'vertraagd', 'verplaatst', 'geannuleerd']

export function TimetablePage() {
  const stages = useAsync(() => api.get<Stage[]>('/stages'))
  const performances = useAsync(() => api.get<Performance[]>('/performances'))
  const [editing, setEditing] = useState<Performance | null>(null)
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [stageFilter, setStageFilter] = useState('')

  const stageName = (id: string) => stages.data?.find((s) => s.id === id)?.name ?? '?'
  const replace = (p: Performance) =>
    performances.setData((list) => (list?.some((x) => x.id === p.id) ? list.map((x) => (x.id === p.id ? p : x)) : [...(list ?? []), p]))

  async function quickStatus(p: Performance, status: Performance['status']) {
    try {
      replace(await api.patch<Performance>(`/admin/performances/${p.id}`, { status }))
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Opslaan mislukt.')
    }
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const value = (name: string) => String(form.get(name) ?? '').trim()
    setError(null)
    try {
      if (editing) {
        replace(
          await api.patch<Performance>(`/admin/performances/${editing.id}`, {
            stageId: value('stageId'),
            startsAt: new Date(value('startsAt')).toISOString(),
            endsAt: new Date(value('endsAt')).toISOString(),
            status: value('status'),
            description: value('description'),
          }),
        )
        setEditing(null)
      } else {
        const body: Record<string, unknown> = {
          stageId: value('stageId'),
          artist: value('artist'),
          startsAt: new Date(value('startsAt')).toISOString(),
          endsAt: new Date(value('endsAt')).toISOString(),
        }
        if (value('description')) body.description = value('description')
        if (value('signupCapacity')) body.signupCapacity = Number(value('signupCapacity'))
        replace(await api.post<Performance>('/admin/performances', body))
        setAdding(false)
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Opslaan mislukt.')
    }
  }

  const sorted = [...(performances.data ?? [])]
    .filter((p) => !stageFilter || p.stageId === stageFilter)
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
  const formOpen = adding || editing !== null

  return (
    <section>
      <header className="page-header">
        <h1>Timetable</h1>
        <p className="muted">Wijzigingen zijn direct live in de app. Bezoekers met dit optreden in hun timetable krijgen een pushmelding.</p>
      </header>
      <div className="toolbar">
        <select value={stageFilter} onChange={(e) => setStageFilter(e.target.value)} aria-label="Podium">
          <option value="">Alle podia</option>
          {stages.data?.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="button primary"
          onClick={() => {
            setEditing(null)
            setAdding(true)
          }}
        >
          + Optreden toevoegen
        </button>
      </div>
      {error && <p className="error">{error}</p>}

      {formOpen && (
        <form className="card form" onSubmit={(e) => void save(e)} key={editing?.id ?? 'new'}>
          <h2>{editing ? `${editing.artist} wijzigen` : 'Nieuw optreden'}</h2>
          <div className="grid-2">
            {!editing && (
              <label>
                Artiest
                <input name="artist" required maxLength={120} />
              </label>
            )}
            <label>
              Podium
              <select name="stageId" required defaultValue={editing?.stageId ?? stages.data?.[0]?.id}>
                {stages.data?.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Begin
              <input name="startsAt" type="datetime-local" required defaultValue={editing ? toLocalInput(editing.startsAt) : ''} />
            </label>
            <label>
              Einde
              <input name="endsAt" type="datetime-local" required defaultValue={editing ? toLocalInput(editing.endsAt) : ''} />
            </label>
            {editing ? (
              <label>
                Status
                <select name="status" defaultValue={editing.status}>
                  {STATUSES.map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
              </label>
            ) : (
              <label>
                Max. aanmeldingen (optioneel)
                <input name="signupCapacity" type="number" min={1} />
              </label>
            )}
            <label>
              Omschrijving
              <input name="description" maxLength={2000} defaultValue={editing?.description ?? ''} />
            </label>
          </div>
          <div className="actions">
            <button className="button primary">Opslaan</button>
            <button
              type="button"
              className="button"
              onClick={() => {
                setAdding(false)
                setEditing(null)
              }}
            >
              Annuleren
            </button>
          </div>
        </form>
      )}

      <table className="table">
        <thead>
          <tr>
            <th>Tijd</th>
            <th>Artiest</th>
            <th>Podium</th>
            <th>Status</th>
            <th aria-label="Acties" />
          </tr>
        </thead>
        <tbody>
          {sorted.map((p) => (
            <tr key={p.id} className={p.status}>
              <td>
                {formatDateTime(p.startsAt)} – {formatTime(p.endsAt)}
              </td>
              <td>
                <strong>{p.artist}</strong>
                {p.signupCapacity ? <span className="muted"> · max. {p.signupCapacity}</span> : null}
              </td>
              <td>{stageName(p.stageId)}</td>
              <td>
                <select value={p.status} onChange={(e) => void quickStatus(p, e.target.value as Performance['status'])} aria-label={`Status ${p.artist}`}>
                  {STATUSES.map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
              </td>
              <td>
                <button
                  type="button"
                  className="link"
                  onClick={() => {
                    setAdding(false)
                    setEditing(p)
                  }}
                >
                  Wijzigen
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}
