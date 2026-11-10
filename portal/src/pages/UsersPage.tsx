import { useState, type FormEvent } from 'react'
import { api, ApiError, type AdminUser } from '../api/client'
import { useAsync } from '../lib/useAsync'

const ROLE_LABEL: Record<AdminUser['role'], string> = { bezoeker: 'Bezoeker', organisatie: 'Organisatie', beheerder: 'Beheerder' }

export function UsersPage() {
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

  async function update(user: AdminUser, body: { ticketType?: 'weekend' | 'vip'; blocked?: boolean; blockedReason?: string }) {
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
    const reason = String(new FormData(event.currentTarget).get('reason') ?? '').trim()
    if (!reason) return
    if (await update(blocking, { blocked: true, blockedReason: reason })) setBlocking(null)
  }

  return (
    <section>
      <header className="page-header">
        <h1>Gebruikers</h1>
        <p className="muted">Zoek een bezoeker om het ticket VIP te maken of het account te blokkeren. Je ziet maximaal 100 resultaten.</p>
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
            Deze bezoeker wordt direct uitgelogd en kan niet meer inloggen. Schrijf een korte, neutrale reden. Geen details over het incident: die horen
            niet in de app.
          </p>
          <label>
            Reden
            <input name="reason" required maxLength={200} placeholder="Incident op het terrein" autoFocus />
          </label>
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
              <th>Soort</th>
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
                <td>{u.role === 'bezoeker' ? <span className={`badge ${u.ticketType === 'vip' ? 'vip' : 'plain'}`}>{u.ticketType ?? 'ticket'}</span> : ROLE_LABEL[u.role]}</td>
                <td>{u.blocked ? <span className="badge nood" title={u.blockedReason ?? undefined}>geblokkeerd</span> : 'actief'}</td>
                <td>
                  {u.role === 'bezoeker' && (
                    <div className="status-edit">
                      <button type="button" className="link" onClick={() => void update(u, { ticketType: u.ticketType === 'vip' ? 'weekend' : 'vip' })}>
                        {u.ticketType === 'vip' ? 'VIP weghalen' : 'VIP maken'}
                      </button>
                      {u.blocked ? (
                        <button type="button" className="link" onClick={() => void update(u, { blocked: false })}>
                          Deblokkeren
                        </button>
                      ) : (
                        <button type="button" className="link danger" onClick={() => setBlocking(u)}>
                          Blokkeren
                        </button>
                      )}
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {users.data?.length === 0 && <p className="empty">Geen gebruikers gevonden.</p>}
      {users.data?.some((u) => u.blocked) && (
        <ul className="list">
          {users.data
            .filter((u) => u.blocked)
            .map((u) => (
              <li key={u.id} className="muted small">
                {u.displayName}: geblokkeerd, reden: {u.blockedReason}
              </li>
            ))}
        </ul>
      )}
    </section>
  )
}
