// Beheerportal: voor iedereen met een rol bij een festival (beheerder, organisatie, EHBO,
// beveiliging) en voor de eigenaren van het platform.
// Let op: de UI verbergt functies, maar de BACKEND dwingt de rollen af.
import { useCallback, useEffect, useState, type FormEvent } from 'react'
import {
  api,
  ApiError,
  clearTokens,
  hasStoredSession,
  setFestival,
  setSessionEndedHandler,
  storeTokens,
  type AuthTokens,
  type Festival,
  type Me,
  type SosAlert,
} from './api/client'
import { connectRealtime, type RealtimeConnection } from './lib/realtime'
import { roleText } from './lib/roles'
import { AnnouncementsPage } from './pages/AnnouncementsPage'
import { CrowdPage } from './pages/CrowdPage'
import { FestivalPage } from './pages/FestivalPage'
import { MapPointsPage } from './pages/MapPointsPage'
import { SosPage } from './pages/SosPage'
import { TeamPage } from './pages/TeamPage'
import { TicketsPage } from './pages/TicketsPage'
import { TimetablePage } from './pages/TimetablePage'
import { UsersPage } from './pages/UsersPage'
import { RealtimeContext } from './lib/realtimeContext'

type Page = 'sos' | 'meldingen' | 'timetable' | 'kaartpunten' | 'drukte' | 'tickets' | 'gebruikers' | 'team' | 'festival'

interface Session {
  me: Me
  /** Festivals waar dit account in het portal bij mag */
  festivals: Festival[]
}

const FESTIVAL_KEY = 'festivalapp.portal.festival'

function rememberFestival(id: string): void {
  try {
    localStorage.setItem(FESTIVAL_KEY, id)
  } catch {
    /* privémodus: dan onthouden we de keuze niet */
  }
}

function rememberedFestival(): string | null {
  try {
    return localStorage.getItem(FESTIVAL_KEY)
  } catch {
    return null
  }
}

/**
 * Haalt op bij welke festivals dit account in het portal mag en kiest er één:
 * `preferred`, anders het festival van de vorige keer, anders het eerste.
 * Geeft null als het account geen toegang heeft tot het portal.
 */
async function loadSession(preferred?: string): Promise<Session | null> {
  // Eerst zonder festival vragen: een oude keuze kan intussen ongeldig zijn
  setFestival(null)
  const all = await api.get<Festival[]>('/festivals')
  const festivals = all.filter((f) => f.role !== 'bezoeker')
  const wanted = preferred ?? rememberedFestival()
  const chosen = festivals.find((f) => f.id === wanted) ?? festivals[0]
  setFestival(chosen?.id ?? null)
  const me = await api.get<Me>('/me')
  // Zonder festival mag alleen een eigenaar naar binnen (om er een aan te maken)
  if (!chosen && !me.platformRole) return null
  return { me, festivals }
}

function Login({ onLogin }: { onLogin: (session: Session) => void }) {
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    setBusy(true)
    setError(null)
    try {
      storeTokens(await api.post<AuthTokens>('/auth/login', { email: form.get('email'), password: form.get('password') }))
      const session = await loadSession()
      if (!session) {
        await api.post('/auth/logout').catch(() => {})
        clearTokens()
        setError('Dit account heeft geen toegang tot het beheerportal.')
        return
      }
      onLogin(session)
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
  const [session, setSession] = useState<Session | null>(null)
  const [checking, setChecking] = useState(hasStoredSession)
  const [page, setPage] = useState<Page>('sos')
  const [realtime, setRealtime] = useState<RealtimeConnection | null>(null)
  const [openSos, setOpenSos] = useState(0)
  const [switchError, setSwitchError] = useState<string | null>(null)

  const me = session?.me ?? null
  const festivalId = me?.festivalId ?? null
  const festival = session?.festivals.find((f) => f.id === festivalId) ?? null

  const endSession = useCallback(() => {
    clearTokens()
    setFestival(null)
    setSession(null)
  }, [])

  useEffect(() => setSessionEndedHandler(endSession), [endSession])

  useEffect(() => {
    if (!checking) return
    loadSession()
      .then((loaded) => (loaded ? setSession(loaded) : endSession()))
      .catch(endSession)
      .finally(() => setChecking(false))
  }, [checking, endSession])

  // Ander festival kiezen: rol en gegevens horen bij het festival, dus alles opnieuw ophalen
  const switchFestival = useCallback(async (id: string) => {
    setSwitchError(null)
    try {
      const loaded = await loadSession(id)
      if (!loaded) return
      if (loaded.me.festivalId) rememberFestival(loaded.me.festivalId)
      setSession(loaded)
    } catch {
      setSwitchError('Wisselen van festival is niet gelukt. Probeer het opnieuw.')
    }
  }, [])

  // Eén verbinding per festival: bij wisselen sluiten en opnieuw verbinden
  const userId = me?.id
  useEffect(() => {
    if (!userId) return
    const connection = connectRealtime()
    // eslint-disable-next-line react-hooks/set-state-in-effect -- koppelen aan een extern systeem (WebSocket)
    setRealtime(connection)
    return () => {
      connection.close()
      setRealtime(null)
    }
  }, [userId, festivalId])

  // Teller voor open SOS-meldingen in het menu
  useEffect(() => {
    if (!userId || !festivalId) return
    const count = () =>
      api
        .get<SosAlert[]>('/admin/sos')
        .then((list) => setOpenSos(list.filter((s) => s.status === 'open').length))
        .catch(() => {})
    void count()
    return realtime?.on('sos.update', () => void count())
  }, [userId, festivalId, realtime])

  if (checking) return <p className="center">Laden…</p>
  if (!session || !me) return <Login onLogin={setSession} />

  // Wat je ziet hangt af van je rol bij het gekozen festival
  const organiser = me.role === 'beheerder' || me.role === 'organisatie'
  const admin = me.role === 'beheerder'
  const pages: { id: Page; label: string; show: boolean }[] = [
    { id: 'sos', label: `🚨 SOS${openSos ? ` (${openSos})` : ''}`, show: festival !== null },
    { id: 'meldingen', label: '📣 Mededelingen', show: organiser },
    { id: 'timetable', label: '🗓️ Timetable', show: organiser },
    { id: 'kaartpunten', label: '📍 Kaartpunten', show: organiser },
    { id: 'drukte', label: '👥 Drukte', show: festival !== null },
    { id: 'tickets', label: '🎟️ Tickets', show: admin },
    { id: 'gebruikers', label: '👤 Gebruikers', show: organiser },
    { id: 'team', label: '🧑‍🤝‍🧑 Team', show: organiser },
    { id: 'festival', label: '🎪 Festival', show: admin || me.platformRole !== null },
  ]
  const visible = pages.filter((p) => p.show)
  // Na het wisselen van festival kan de huidige pagina niet meer bij je rol horen
  const current = visible.some((p) => p.id === page) ? page : (visible[0]?.id ?? 'festival')

  return (
    <RealtimeContext.Provider value={realtime}>
      <div className="layout">
        <aside className="sidebar">
          <div className="brand">
            <img src={`${import.meta.env.BASE_URL}logo.png`} alt="" width={36} height={36} />
            <strong>Beheerportal</strong>
          </div>
          <div className="festival-switch">
            <span className="festival-label">Festival</span>
            {session.festivals.length > 1 ? (
              <select aria-label="Festival dat je beheert" value={festivalId ?? ''} onChange={(e) => void switchFestival(e.target.value)}>
                {session.festivals.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </select>
            ) : (
              <strong>{festival?.name ?? 'Nog geen festival'}</strong>
            )}
            {switchError && (
              <p className="error" role="alert">
                {switchError}
              </p>
            )}
          </div>
          <nav aria-label="Beheer">
            {visible.map((p) => (
              <button
                key={p.id}
                type="button"
                aria-current={current === p.id ? 'page' : undefined}
                className={p.id === 'sos' && openSos ? 'alert' : ''}
                onClick={() => setPage(p.id)}
              >
                {p.label}
              </button>
            ))}
          </nav>
          <div className="who">
            <span>
              {me.displayName} · {roleText(me)}
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
        {/* key: bij een ander festival beginnen alle pagina's opnieuw, zodat er geen gegevens van het vorige blijven staan */}
        <main className="main" key={festivalId ?? 'geen'}>
          {current === 'sos' && <SosPage />}
          {current === 'meldingen' && <AnnouncementsPage />}
          {current === 'timetable' && <TimetablePage />}
          {current === 'kaartpunten' && <MapPointsPage />}
          {current === 'gebruikers' && <UsersPage me={me} />}
          {current === 'drukte' && <CrowdPage />}
          {current === 'tickets' && <TicketsPage />}
          {current === 'team' && <TeamPage me={me} />}
          {current === 'festival' && (
            <FestivalPage
              me={me}
              festival={festival}
              onSaved={(saved) => setSession((s) => s && { ...s, festivals: s.festivals.map((f) => (f.id === saved.id ? saved : f)) })}
              onCreated={(created) => void switchFestival(created.id)}
            />
          )}
        </main>
      </div>
    </RealtimeContext.Provider>
  )
}
