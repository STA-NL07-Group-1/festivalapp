import { useState, type FormEvent } from 'react'
import { api, ApiError, type AdminUser, type Me } from '../api/client'
import { useAsync } from '../lib/useAsync'

type BlockScope = 'festival' | 'alle'

export function UsersPage({ me }: { me: Me }) {
  const [query, setQuery] = useState('')
  const [search, setSearch] = useState('')
  const users = useAsync(() => api.get<AdminUser[]>(`/admin/users?q=${encodeURIComponent(search)}`), [search])
  const [error, setError] = useState<string | null>(null)
  // Bezoeker waarvoor het blokkeer-formulier open staat
  const [blocking, setBlocking] = useState<AdminUser | null>(null)

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSearch(query.trim())
  }

  async function update(user: AdminUser, body: { ticketType?: 'weekend' | 'vip'; blocked?: boolean; blockedReason?: string; blockScope?: BlockScope }) {
    setError(null)
    try {
      const updated = await api.patch<AdminUser>(`/admin/users/${user.id}`, body)
      users.setData((list) => (list ?? []).map((u) => (u.id === updated.id ? updated : u)))
      return true
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Wijzigen mislukt.')
      return false
    }
  }

  async function submitBlock(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!blocking) return
    const form = new FormData(event.currentTarget)
    const reason = String(form.get('reason') ?? '').trim()
    if (!reason) return
    const blockScope: BlockScope = form.get('scope') === 'alle' ? 'alle' : 'festival'
    if (await update(blocking, { blocked: true, blockedReason: reason, blockScope })) setBlocking(null)
  }

  return (
    <section>
      <header className="page-header">
        <h1>Gebruikers</h1>
        <p className="muted">
          Bezoekers met een ticket van dit festival. Zoek iemand om het ticket VIP te maken of te blokkeren. Je ziet maximaal 100 resultaten.
        </p>
      </header>

      <form className="search-bar" onSubmit={submitSearch} role="search">
        <label className="sr-only" htmlFor="user-search">
          Zoek op naam of e-mailadres
        </label>
        <input id="user-search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Zoek op naam of e-mailadres" maxLength={100} />
        <button className="button">Zoeken</button>
      </form>

      {error && <p className="error">{error}</p>}

      {blocking && (
        <form className="card form" onSubmit={(e) => void submitBlock(e)}>
          <h2>{blocking.displayName} blokkeren</h2>
          <p className="muted">
            Deze bezoeker kan niet meer bij dit festival: geen kaart, timetable of mededelingen. Het account, de vrienden en de chats blijven bestaan.
            Schrijf een korte, neutrale reden. Geen details over het incident: die horen niet in de app.
          </p>
          <label>
            Reden
            <input name="reason" required maxLength={200} placeholder="Incident op het terrein" autoFocus />
          </label>
          {/* Voor alle festivals blokkeren is voor ernstige gevallen en kan alleen de eigenaar */}
          {me.platformRole && (
            <label>
              Geldt voor
              <select name="scope" defaultValue="festival">
                <option value="festival">Alleen dit festival</option>
                <option value="alle">Alle festivals (wordt direct uitgelogd en kan niet meer inloggen)</option>
              </select>
            </label>
          )}
          <div className="status-edit">
            <button className="button danger">Blokkeren</button>
            <button type="button" className="link" onClick={() => setBlocking(null)}>
              Annuleren
            </button>
          </div>
        </form>
      )}

      <div className="table-scroll">
        <table className="table">
          <thead>
            <tr>
              <th>Naam</th>
              <th>E-mailadres</th>
              <th>Ticket</th>
              <th>Status</th>
              <th>
                <span className="sr-only">Acties</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {users.data?.map((u) => (
              <tr key={u.id}>
                <td>
                  <strong>{u.displayName}</strong>
                </td>
                <td>{u.email}</td>
                <td>
                  <span className={`badge ${u.ticketType === 'vip' ? 'vip' : 'plain'}`}>{u.ticketType ?? 'ticket'}</span>
                </td>
                <td>{u.blocked ? <span className="badge nood">{u.blockScope === 'alle' ? 'geblokkeerd, alle festivals' : 'geblokkeerd'}</span> : 'actief'}</td>
                <td>
                  <div className="status-edit">
                    <button type="button" className="link" onClick={() => void update(u, { ticketType: u.ticketType === 'vip' ? 'weekend' : 'vip' })}>
                      {u.ticketType === 'vip' ? 'VIP weghalen' : 'VIP maken'}
                    </button>
                    {u.blocked ? (
                      // Een blokkade voor alle festivals kan alleen de eigenaar opheffen
                      (u.blockScope !== 'alle' || me.platformRole) && (
                        <button type="button" className="link" onClick={() => void update(u, { blocked: false })}>
                          Deblokkeren
                        </button>
                      )
                    ) : (
                      <button type="button" className="link danger" onClick={() => setBlocking(u)}>
                        Blokkeren
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {users.data?.length === 0 && <p className="empty">Geen bezoekers gevonden.</p>}
      {users.data?.some((u) => u.blocked) && (
        <ul className="list">
          {users.data
            .filter((u) => u.blocked)
            .map((u) => (
              <li key={u.id} className="muted small">
                {u.displayName}: geblokkeerd{u.blockScope === 'alle' ? ' voor alle festivals' : ''}, reden: {u.blockedReason}
              </li>
            ))}
        </ul>
      )}
    </section>
  )
}
