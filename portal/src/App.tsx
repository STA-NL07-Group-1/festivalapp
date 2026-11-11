// Beheerportal: alleen voor accounts met de rol organisatie of beheerder.
// Let op: de UI verbergt functies, maar de BACKEND dwingt de rollen af.
import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { api, ApiError, clearTokens, hasStoredSession, setSessionEndedHandler, storeTokens, type AuthTokens, type Me, type SosAlert } from './api/client'
import { connectRealtime, type RealtimeConnection } from './lib/realtime'
import { AnnouncementsPage } from './pages/AnnouncementsPage'
import { CrowdPage } from './pages/CrowdPage'
import { MapPointsPage } from './pages/MapPointsPage'
import { SosPage } from './pages/SosPage'
import { TicketsPage } from './pages/TicketsPage'
import { TimetablePage } from './pages/TimetablePage'
import { UsersPage } from './pages/UsersPage'
import { RealtimeContext } from './lib/realtimeContext'

type Page = 'sos' | 'meldingen' | 'timetable' | 'kaartpunten' | 'drukte' | 'tickets' | 'gebruikers'

function Login({ onLogin }: { onLogin: (me: Me) => void }) {
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    setBusy(true)
    setError(null)
    try {
      storeTokens(await api.post<AuthTokens>('/auth/login', { email: form.get('email'), password: form.get('password') }))
      const me = await api.get<Me>('/me')
      if (me.role === 'bezoeker') {
        await api.post('/auth/logout').catch(() => {})
        clearTokens()
        setError('Dit account heeft geen toegang tot het beheerportal.')
        return
      }
      onLogin(me)
    } catch (e) {
      setError(e instanceof ApiError && e.status === 429 ? 'Te veel pogingen. Wacht even.' : 'E-mailadres of wachtwoord klopt niet.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="login">
      <form className="card" onSubmit={(e) => void submit(e)}>
        <img src={`${import.meta.env.BASE_URL}logo.png`} alt="" width={64} height={64} />
        <h1>Beheerportal</h1>
        <label>
          E-mailadres
          <input name="email" type="email" required autoComplete="username" />
        </label>
        <label>
          Wachtwoord
          <input name="password" type="password" required autoComplete="current-password" />
        </label>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <button className="button primary" disabled={busy}>
          {busy ? 'Bezig…' : 'Inloggen'}
        </button>
      </form>
    </main>
  )
}

export default function App() {
  const [me, setMe] = useState<Me | null>(null)
  const [checking, setChecking] = useState(hasStoredSession)
  const [page, setPage] = useState<Page>('sos')
  const [realtime, setRealtime] = useState<RealtimeConnection | null>(null)
  const [openSos, setOpenSos] = useState(0)

  const endSession = useCallback(() => {
    clearTokens()
    setMe(null)
  }, [])

  useEffect(() => setSessionEndedHandler(endSession), [endSession])

  useEffect(() => {
    if (!checking) return
    api
      .get<Me>('/me')
      .then((user) => (user.role === 'bezoeker' ? endSession() : setMe(user)))
      .catch(endSession)
      .finally(() => setChecking(false))
  }, [checking, endSession])

  useEffect(() => {
    if (!me) return
    const connection = connectRealtime()
    // eslint-disable-next-line react-hooks/set-state-in-effect -- koppelen aan een extern systeem (WebSocket)
    setRealtime(connection)
    return () => {
      connection.close()
      setRealtime(null)
    }
  }, [me])

  // Teller voor open SOS-meldingen in het menu
  useEffect(() => {
    if (!me) return
    const count = () =>
      api
        .get<SosAlert[]>('/admin/sos')
        .then((list) => setOpenSos(list.filter((s) => s.status === 'open').length))
        .catch(() => {})
    void count()
    return realtime?.on('sos.update', () => void count())
  }, [me, realtime])

  if (checking) return <p className="center">Laden…</p>
  if (!me) return <Login onLogin={setMe} />

  const pages: { id: Page; label: string; show: boolean }[] = [
    { id: 'sos', label: `🚨 SOS${openSos ? ` (${openSos})` : ''}`, show: true },
    { id: 'meldingen', label: '📣 Mededelingen', show: true },
    { id: 'timetable', label: '🗓️ Timetable', show: true },
    { id: 'kaartpunten', label: '📍 Kaartpunten', show: true },
    { id: 'drukte', label: '👥 Drukte', show: true },
    { id: 'tickets', label: '🎟️ Tickets', show: me.role === 'beheerder' },
    { id: 'gebruikers', label: '👤 Gebruikers', show: me.role === 'beheerder' },
  ]

  return (
    <RealtimeContext.Provider value={realtime}>
      <div className="layout">
        <aside className="sidebar">
          <div className="brand">
            <img src={`${import.meta.env.BASE_URL}logo.png`} alt="" width={36} height={36} />
            <strong>Beheerportal</strong>
          </div>
          <nav aria-label="Beheer">
            {pages
              .filter((p) => p.show)
              .map((p) => (
                <button
                  key={p.id}
                  type="button"
                  aria-current={page === p.id ? 'page' : undefined}
                  className={p.id === 'sos' && openSos ? 'alert' : ''}
                  onClick={() => setPage(p.id)}
                >
                  {p.label}
                </button>
              ))}
          </nav>
          <div className="who">
            <span>
              {me.displayName} · {me.role}
            </span>
            <button
              type="button"
              className="link"
              onClick={() => {
                void api.post('/auth/logout').finally(endSession)
              }}
            >
              Uitloggen
            </button>
          </div>
        </aside>
        <main className="main">
          {page === 'sos' && <SosPage />}
          {page === 'meldingen' && <AnnouncementsPage />}
          {page === 'timetable' && <TimetablePage />}
          {page === 'kaartpunten' && <MapPointsPage />}
          {page === 'gebruikers' && me.role === 'beheerder' && <UsersPage />}
          {page === 'drukte' && <CrowdPage />}
          {page === 'tickets' && me.role === 'beheerder' && <TicketsPage />}
        </main>
      </div>
    </RealtimeContext.Provider>
  )
}
