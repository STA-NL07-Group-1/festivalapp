import { useState, type FormEvent } from 'react'
import { api, ApiError, type FestivalRole, type Me, type TeamMember } from '../api/client'
import { assignableRoles, ROLE_LABEL } from '../lib/roles'
import { useAsync } from '../lib/useAsync'

const ROLE_HELP: Record<FestivalRole, string> = {
  beheerder: 'Alles van dit festival, ook tickets en de festivalgegevens.',
  organisatie: 'Mededelingen, timetable, kaartpunten en bezoekers.',
  ehbo: 'Ziet SOS-meldingen met de locatie en handelt ze af.',
  beveiliging: 'Ziet SOS-meldingen met de locatie en handelt ze af.',
}

export function TeamPage({ me }: { me: Me }) {
  const team = useAsync(() => api.get<TeamMember[]>('/admin/team'))
  const roles = assignableRoles(me)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const formElement = event.currentTarget
    const form = new FormData(formElement)
    const email = String(form.get('email') ?? '').trim()
    const body: Record<string, string> = { email, role: String(form.get('role')) }
    // Naam en wachtwoord zijn alleen nodig voor iemand die nog geen account heeft
    const displayName = String(form.get('displayName') ?? '').trim()
    const password = String(form.get('password') ?? '')
    const newAccount = displayName !== '' && password !== ''
    if (newAccount) {
      body.displayName = displayName
      body.password = password
    }
    setError(null)
    setNotice(null)
    setBusy(true)
    try {
      const saved = await api.put<TeamMember>('/admin/team', body)
      team.setData((list) => [...(list ?? []).filter((m) => m.userId !== saved.userId), saved])
      setNotice(
        newAccount
          ? `${saved.displayName} is nu ${ROLE_LABEL[saved.role].toLowerCase()}. Had deze persoon nog geen account, geef dan het tijdelijke wachtwoord persoonlijk door.`
          : `${saved.displayName} is nu ${ROLE_LABEL[saved.role].toLowerCase()}.`,
      )
      formElement.reset()
    } catch (e) {
      // Bestaat het account nog niet, dan legt de melding van de backend uit wat er nodig is
      setError(e instanceof ApiError ? e.message : 'Opslaan mislukt.')
    } finally {
      setBusy(false)
    }
  }

  async function changeRole(member: TeamMember, role: FestivalRole) {
    setError(null)
    setNotice(null)
    try {
      const saved = await api.put<TeamMember>('/admin/team', { email: member.email, role })
      team.setData((list) => (list ?? []).map((m) => (m.userId === saved.userId ? saved : m)))
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Wijzigen mislukt.')
    }
  }

  async function remove(member: TeamMember) {
    if (!window.confirm(`${member.displayName} uit het team van dit festival halen? Het account zelf blijft bestaan.`)) return
    setError(null)
    setNotice(null)
    try {
      await api.delete(`/admin/team/${member.userId}`)
      team.setData((list) => (list ?? []).filter((m) => m.userId !== member.userId))
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Verwijderen mislukt.')
    }
  }

  const sorted = [...(team.data ?? [])].sort((a, b) => a.role.localeCompare(b.role) || a.displayName.localeCompare(b.displayName))

  return (
    <section>
      <header className="page-header">
        <h1>Team</h1>
        <p className="muted">
          Wie bij dit festival in het beheerportal mag. Een rol geldt alleen voor dit festival.
          {me.platformRole !== 'sudo' && ' Een beheerder aanwijzen kan alleen de eigenaar van het platform (sudo).'}
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
                  <th>Naam</th>
                  <th>E-mailadres</th>
                  <th>Rol</th>
                  <th>
                    <span className="sr-only">Acties</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((m) => {
                  // Alleen wie je deze rol zelf zou mogen geven, mag je wijzigen of weghalen
                  const editable = m.userId !== me.id && roles.includes(m.role)
                  return (
                    <tr key={m.userId}>
                      <td>
                        <strong>{m.displayName}</strong>
                        {m.userId === me.id && <span className="muted"> (jij)</span>}
                      </td>
                      <td>{m.email}</td>
                      <td>
                        {editable ? (
                          <select aria-label={`Rol van ${m.displayName}`} value={m.role} onChange={(e) => void changeRole(m, e.target.value as FestivalRole)}>
                            {roles.map((r) => (
                              <option key={r} value={r}>
                                {ROLE_LABEL[r]}
                              </option>
                            ))}
                          </select>
                        ) : (
                          ROLE_LABEL[m.role]
                        )}
                      </td>
                      <td>
                        {editable && (
                          <button type="button" className="link danger" onClick={() => void remove(m)}>
                            Uit team halen
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          {team.data?.length === 0 && <p className="empty">Dit festival heeft nog geen team.</p>}
        </div>

        {roles.length > 0 && (
          <form className="card form" onSubmit={(e) => void submit(e)}>
            <h2>Iemand toevoegen</h2>
            <label>
              E-mailadres
              <input name="email" type="email" required maxLength={254} autoComplete="off" />
            </label>
            <label>
              Rol
              <select name="role" defaultValue={roles[roles.length - 1]}>
                {roles.map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABEL[r]}
                  </option>
                ))}
              </select>
            </label>
            <ul className="muted small role-help">
              {roles.map((r) => (
                <li key={r}>
                  <strong>{ROLE_LABEL[r]}:</strong> {ROLE_HELP[r]}
                </li>
              ))}
            </ul>
            <details>
              <summary>Heeft deze persoon nog geen account?</summary>
              <p className="muted small">Vul dan ook een naam en een tijdelijk wachtwoord in. Het account wordt aangemaakt zonder ticket.</p>
              <label>
                Naam
                <input name="displayName" maxLength={40} autoComplete="off" />
              </label>
              <label>
                Tijdelijk wachtwoord (minstens 12 tekens)
                <input name="password" type="password" minLength={12} maxLength={128} autoComplete="new-password" />
              </label>
            </details>
            {notice && (
              <p className="muted" role="status">
                {notice}
              </p>
            )}
            <button className="button primary" disabled={busy}>
              Toevoegen
            </button>
          </form>
        )}
      </div>
    </section>
  )
}
