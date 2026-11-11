import { useState, type FormEvent } from 'react'
import { api, ApiError, type Festival, type Me, type Owner } from '../api/client'
import { formatDateTime, toLocalInput } from '../lib/realtimeContext'
import { useAsync } from '../lib/useAsync'

const toIso = (value: FormDataEntryValue | null) => new Date(String(value)).toISOString()

/** Naam en datums van het gekozen festival. Alleen voor de beheerder. */
function EditFestival({ festival, onSaved }: { festival: Festival; onSaved: (festival: Festival) => void }) {
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    setError(null)
    setSaved(false)
    try {
      onSaved(
        await api.patch<Festival>('/admin/festival', {
          name: String(form.get('name') ?? '').trim(),
          startsAt: toIso(form.get('startsAt')),
          endsAt: toIso(form.get('endsAt')),
        }),
      )
      setSaved(true)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Opslaan mislukt.')
    }
  }

  return (
    <form className="card form" onSubmit={(e) => void submit(e)}>
      <h2>Dit festival</h2>
      <label>
        Naam
        <input name="name" required maxLength={80} defaultValue={festival.name} />
      </label>
      <div className="grid-2">
        <label>
          Begint
          <input name="startsAt" type="datetime-local" required defaultValue={toLocalInput(festival.startsAt)} />
        </label>
        <label>
          Eindigt
          <input name="endsAt" type="datetime-local" required defaultValue={toLocalInput(festival.endsAt)} />
        </label>
      </div>
      <p className="muted small">Na de einddatum kunnen bezoekers niet meer bij de kaart, de timetable en de andere gegevens van dit festival.</p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {saved && (
        <p className="muted" role="status">
          Opgeslagen.
        </p>
      )}
      <button className="button primary">Opslaan</button>
    </form>
  )
}

/** Een nieuw festival aanmaken. Alleen voor eigenaren en sudo. */
function NewFestival({ onCreated }: { onCreated: (festival: Festival) => void }) {
  const [error, setError] = useState<string | null>(null)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const formElement = event.currentTarget
    const form = new FormData(formElement)
    setError(null)
    try {
      const created = await api.post<Festival>('/admin/festivals', {
        name: String(form.get('name') ?? '').trim(),
        startsAt: toIso(form.get('startsAt')),
        endsAt: toIso(form.get('endsAt')),
      })
      formElement.reset()
      onCreated(created)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Aanmaken mislukt.')
    }
  }

  return (
    <form className="card form" onSubmit={(e) => void submit(e)}>
      <h2>Nieuw festival</h2>
      <label>
        Naam
        <input name="name" required maxLength={80} placeholder="Zomerfestival" />
      </label>
      <div className="grid-2">
        <label>
          Begint
          <input name="startsAt" type="datetime-local" required />
        </label>
        <label>
          Eindigt
          <input name="endsAt" type="datetime-local" required />
        </label>
      </div>
      <p className="muted small">Het nieuwe festival begint leeg. Na het aanmaken schakelt het portal ernaar over, zodat je podia, tickets en een team kunt toevoegen.</p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <button className="button primary">Festival aanmaken</button>
    </form>
  )
}

/** Wie mag bij alle festivals? Alleen sudo kan dit zien en wijzigen. */
function Owners() {
  const owners = useAsync(() => api.get<Owner[]>('/admin/owners'))
  const [error, setError] = useState<string | null>(null)

  async function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const formElement = event.currentTarget
    setError(null)
    try {
      const saved = await api.put<Owner>('/admin/owners', { email: String(new FormData(formElement).get('email') ?? '').trim() })
      owners.setData((list) => [...(list ?? []).filter((o) => o.userId !== saved.userId), saved])
      formElement.reset()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Opslaan mislukt.')
    }
  }

  async function remove(owner: Owner) {
    if (!window.confirm(`${owner.displayName} is daarna geen eigenaar meer. Doorgaan?`)) return
    setError(null)
    try {
      await api.delete(`/admin/owners/${owner.userId}`)
      owners.setData((list) => (list ?? []).filter((o) => o.userId !== owner.userId))
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Verwijderen mislukt.')
    }
  }

  return (
    <div className="card form">
      <h2>Eigenaren</h2>
      <p className="muted small">
        Een eigenaar mag bij elk festival, maakt festivals aan en wijst organisatoren aan. Alleen jij (sudo) wijst eigenaren en beheerders aan.
      </p>
      <ul className="list">
        {owners.data?.map((o) => (
          <li key={o.userId} className="owner-row">
            <span>
              <strong>{o.displayName}</strong> <span className="muted">{o.email}</span>
            </span>
            {o.platformRole === 'sudo' ? (
              <span className="badge vip">sudo</span>
            ) : (
              <button type="button" className="link danger" onClick={() => void remove(o)}>
                Weghalen
              </button>
            )}
          </li>
        ))}
      </ul>
      <form className="search-bar" onSubmit={(e) => void add(e)}>
        <label className="sr-only" htmlFor="owner-email">
          E-mailadres van een bestaand account
        </label>
        <input id="owner-email" name="email" type="email" required maxLength={254} placeholder="E-mailadres van een bestaand account" autoComplete="off" />
        <button className="button">Eigenaar maken</button>
      </form>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}

export function FestivalPage({
  me,
  festival,
  onSaved,
  onCreated,
}: {
  me: Me
  festival: Festival | null
  onSaved: (festival: Festival) => void
  onCreated: (festival: Festival) => void
}) {
  return (
    <section>
      <header className="page-header">
        <h1>Festival</h1>
        {festival && (
          <p className="muted">
            {festival.name}: {formatDateTime(festival.startsAt)} tot {formatDateTime(festival.endsAt)}
            {festival.active ? ' · nu bezig' : ''}
          </p>
        )}
      </header>
      <div className="two-columns">
        <div className="form">
          {/* key: bij een ander festival het formulier opnieuw vullen */}
          {festival && me.role === 'beheerder' && <EditFestival key={festival.id} festival={festival} onSaved={onSaved} />}
          {me.platformRole && <NewFestival onCreated={onCreated} />}
        </div>
        {me.platformRole === 'sudo' && <Owners />}
      </div>
    </section>
  )
}
