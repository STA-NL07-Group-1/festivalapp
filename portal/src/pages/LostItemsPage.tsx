import { useState, type FormEvent } from 'react'
import { api, ApiError, type LostItem, type Me } from '../api/client'
import { formatDateTime } from '../lib/realtimeContext'
import { useAsync } from '../lib/useAsync'

export function LostItemsPage({ me }: { me: Me }) {
  const items = useAsync(() => api.get<LostItem[]>('/admin/lost-items'))
  const [error, setError] = useState<string | null>(null)
  // Verwijderen mag alleen de organisatie; EHBO en beveiliging registreren en geven terug
  const canDelete = me.role === 'beheerder' || me.role === 'organisatie'

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const formElement = event.currentTarget
    const form = new FormData(formElement)
    setError(null)
    const foundWhere = String(form.get('foundWhere') ?? '').trim()
    try {
      const created = await api.post<LostItem>('/admin/lost-items', {
        description: String(form.get('description') ?? '').trim(),
        ...(foundWhere ? { foundWhere } : {}),
      })
      items.setData((list) => [created, ...(list ?? [])])
      formElement.reset()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Opslaan mislukt.')
    }
  }

  async function setStatus(item: LostItem, status: LostItem['status']) {
    setError(null)
    try {
      const updated = await api.patch<LostItem>(`/admin/lost-items/${item.id}`, { status })
      items.setData((list) => (list ?? []).map((i) => (i.id === updated.id ? updated : i)))
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Wijzigen mislukt.')
    }
  }

  async function remove(item: LostItem) {
    if (!window.confirm(`"${item.description}" verwijderen?`)) return
    setError(null)
    try {
      await api.delete(`/admin/lost-items/${item.id}`)
      items.setData((list) => (list ?? []).filter((i) => i.id !== item.id))
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Verwijderen mislukt.')
    }
  }

  return (
    <section>
      <header className="page-header">
        <h1>Gevonden voorwerpen</h1>
        <p className="muted">
          Bezoekers zien in de app wat nog niet is opgehaald (laatste 30 dagen). Schrijf alleen een korte omschrijving: geen namen of andere gegevens van de eigenaar.
        </p>
      </header>
      <div className="two-columns">
        <div>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th>Voorwerp</th>
                  <th>Gevonden</th>
                  <th>Status</th>
                  <th>
                    <span className="sr-only">Acties</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {items.data?.map((i) => (
                  <tr key={i.id}>
                    <td>
                      <strong>{i.description}</strong>
                      {i.foundWhere && <div className="muted small">{i.foundWhere}</div>}
                    </td>
                    <td>{formatDateTime(i.foundAt)}</td>
                    <td>{i.status === 'opgehaald' ? <span className="badge afgehandeld">opgehaald</span> : <span className="badge">ligt klaar</span>}</td>
                    <td>
                      <div className="status-edit">
                        {i.status === 'gevonden' ? (
                          <button type="button" className="link" onClick={() => void setStatus(i, 'opgehaald')}>
                            Opgehaald
                          </button>
                        ) : (
                          <button type="button" className="link" onClick={() => void setStatus(i, 'gevonden')}>
                            Terugzetten
                          </button>
                        )}
                        {canDelete && (
                          <button type="button" className="link danger" onClick={() => void remove(i)}>
                            Verwijderen
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {items.data?.length === 0 && <p className="empty">Nog niets gevonden.</p>}
        </div>

        <form className="card form" onSubmit={(e) => void submit(e)}>
          <h2>Voorwerp registreren</h2>
          <label>
            Omschrijving
            <input name="description" required maxLength={200} placeholder="Zwarte regenjas" />
          </label>
          <label>
            Waar gevonden (optioneel)
            <input name="foundWhere" maxLength={100} placeholder="Bij de Bosstage" />
          </label>
          <button className="button primary">Registreren</button>
        </form>
      </div>
    </section>
  )
}
