// Sessie: ingelogde gebruiker, instellingen (thema/taal), het gekozen festival en de realtime-verbinding.
import { createContext, useCallback, useContext, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react'
import {
  api,
  ApiError,
  clearTokens,
  hasStoredSession,
  isNetworkOnline,
  onNetworkChange,
  setFestival,
  setNetworkOnline,
  setSessionEndedHandler,
  storeTokens,
  type AuthTokens,
  type Festival,
  type Me,
} from '../api/client'
import { I18nProvider } from '../i18n'
import { detectLocale } from '../i18n/translate'
import type { Locale } from '../lib/format'
import { clearOffline, clearOfflineFestival, loadOffline, saveOffline } from '../lib/offlineStore'
import { connectRealtime, type RealtimeConnection } from '../lib/realtime'

type Status = 'loading' | 'anonymous' | 'authenticated'

interface Session {
  status: Status
  me: Me | null
  /** Festivals waar je bij mag: met een ticket (tot het festival is afgelopen) of als personeel */
  festivals: Festival[]
  /** Het gekozen festival; null als je (nog) bij geen festival hoort */
  festival: Festival | null
  realtime: RealtimeConnection | null
  /** Er is internet en de server is bereikbaar */
  online: boolean
  /** De live-verbinding (WebSocket) staat open */
  live: boolean
  /** Donker thema actief (instelling of systeemvoorkeur) */
  dark: boolean
  login(email: string, password: string): Promise<void>
  register(input: { ticketCode: string; email: string; password: string; displayName: string }): Promise<void>
  logout(): Promise<void>
  updateMe(patch: Partial<Pick<Me, 'displayName' | 'theme' | 'locale' | 'shareLocation' | 'shareTimetable'>>): Promise<void>
  deleteAccount(): Promise<void>
  setLocale(locale: Locale): void
  /** Wissel van festival: de app haalt daarna alles opnieuw op */
  chooseFestival(id: string): Promise<void>
  /** Voegt een ticket toe en kiest het festival dat erbij hoort. Geeft dat festival terug. */
  addTicket(ticketCode: string): Promise<Festival | null>
}

const FESTIVAL_KEY = 'festivalapp.festival'

function rememberedFestival(): string | null {
  try {
    return localStorage.getItem(FESTIVAL_KEY)
  } catch {
    return null
  }
}

function rememberFestival(id: string | null): void {
  try {
    if (id) localStorage.setItem(FESTIVAL_KEY, id)
    else localStorage.removeItem(FESTIVAL_KEY)
  } catch {
    /* niets */
  }
}

interface Loaded {
  me: Me
  festivals: Festival[]
}

/**
 * Haalt je festivals en je account op en kiest een festival: `preferred`, anders het festival
 * van de vorige keer, anders het festival dat de server voorstelt (nu bezig, of het eerstvolgende).
 */
async function loadAccount(preferred?: string): Promise<Loaded> {
  const festivals = await api.get<Festival[]>('/festivals')
  const wanted = preferred ?? rememberedFestival()
  const chosen = festivals.find((f) => f.id === wanted) ?? festivals[0] ?? null
  setFestival(chosen?.id ?? null)
  const me = await api.get<Me>('/me')

  // Festivals waar je niet meer bij mag (afgelopen of geblokkeerd): bewaarde gegevens weggooien
  const before = loadOffline<Festival[]>('festivals')?.data ?? []
  for (const old of before) if (!festivals.some((f) => f.id === old.id)) clearOfflineFestival(old.id)

  saveOffline('festivals', festivals)
  saveOffline('me', me)
  rememberFestival(me.festivalId)
  return { me, festivals }
}

const SessionContext = createContext<Session | null>(null)

const DARK_QUERY = '(prefers-color-scheme: dark)'

function subscribeToColorScheme(onChange: () => void) {
  const media = window.matchMedia?.(DARK_QUERY)
  media?.addEventListener('change', onChange)
  return () => media?.removeEventListener('change', onChange)
}

/** Volgt de systeemvoorkeur voor donker/licht. */
function usePrefersDark(): boolean {
  return useSyncExternalStore(subscribeToColorScheme, () => window.matchMedia?.(DARK_QUERY).matches ?? true)
}

function applyTheme(dark: boolean) {
  document.documentElement.dataset.theme = dark ? 'dark' : 'light'
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#0f0920' : '#f6f3fb')
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>(() => (hasStoredSession() ? 'loading' : 'anonymous'))
  const [me, setMe] = useState<Me | null>(null)
  const [festivals, setFestivals] = useState<Festival[]>([])
  const [localLocale, setLocalLocale] = useState<Locale>(detectLocale)
  const [realtime, setRealtime] = useState<RealtimeConnection | null>(null)
  const [online, setOnline] = useState(isNetworkOnline)
  const [live, setLive] = useState(false)

  const locale: Locale = me?.locale ?? localLocale
  const festivalId = me?.festivalId ?? null
  const festival = festivals.find((f) => f.id === festivalId) ?? null
  const prefersDark = usePrefersDark()
  const dark = me?.theme === 'donker' || (me?.theme !== 'licht' && prefersDark)

  const endSession = useCallback(() => {
    clearTokens()
    clearOffline()
    setFestival(null)
    rememberFestival(null)
    setMe(null)
    setFestivals([])
    setStatus('anonymous')
  }, [])

  useEffect(() => setSessionEndedHandler(endSession), [endSession])

  const applyLoaded = useCallback(({ me: user, festivals: list }: Loaded) => {
    setFestivals(list)
    setMe(user)
  }, [])

  // Bij het opstarten: bestaande sessie herstellen
  useEffect(() => {
    if (status !== 'loading') return
    loadAccount()
      .then((loaded) => {
        applyLoaded(loaded)
        setStatus('authenticated')
      })
      .catch((error: unknown) => {
        // Zonder internet: niet uitloggen, maar verder met het bewaarde account en festival
        const stored = loadOffline<Me>('me')
        if (error instanceof ApiError && error.status === 0 && stored) {
          setFestival(stored.data.festivalId)
          setFestivals(loadOffline<Festival[]>('festivals')?.data ?? [])
          setMe(stored.data)
          setStatus('authenticated')
          return
        }
        endSession()
      })
  }, [status, endSession, applyLoaded])

  // Terug in de app (bijv. de volgende ochtend): festivals opnieuw ophalen. Is het gekozen
  // festival intussen afgelopen, dan kiest loadAccount vanzelf een ander.
  useEffect(() => {
    if (status !== 'authenticated') return
    const onVisible = () => {
      if (document.visibilityState !== 'visible' || !isNetworkOnline()) return
      loadAccount(festivalId ?? undefined)
        .then(applyLoaded)
        .catch(() => {})
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [status, festivalId, applyLoaded])

  // Realtime-verbinding zolang je bent ingelogd; opnieuw verbinden bij een ander festival
  useEffect(() => {
    if (status !== 'authenticated') return
    const connection = connectRealtime()
    // Koppelen aan een extern systeem (WebSocket): hier hoort setState in een effect
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRealtime(connection)
    const offStatus = connection.onStatus((connected) => {
      setLive(connected)
      // Lukt de live-verbinding, dan is er dus ook internet
      if (connected) setNetworkOnline(true)
    })
    return () => {
      offStatus()
      connection.close()
      setRealtime(null)
      setLive(false)
    }
  }, [status, festivalId])

  useEffect(() => {
    const offNetwork = onNetworkChange(setOnline)
    const up = () => {
      // Het netwerk is terug: even de server proberen, dan weten we of er echt internet is
      api.get('/health').catch(() => {})
    }
    const down = () => setNetworkOnline(false)
    window.addEventListener('online', up)
    window.addEventListener('offline', down)
    return () => {
      offNetwork()
      window.removeEventListener('online', up)
      window.removeEventListener('offline', down)
    }
  }, [])

  useEffect(() => applyTheme(dark), [dark])

  useEffect(() => {
    document.documentElement.lang = locale
  }, [locale])

  const startSession = useCallback(
    async (tokens: AuthTokens) => {
      storeTokens(tokens)
      applyLoaded(await loadAccount())
      setStatus('authenticated')
    },
    [applyLoaded],
  )

  const value = useMemo<Session>(
    () => ({
      status,
      me,
      festivals,
      festival,
      realtime,
      online,
      live,
      dark,
      async login(email, password) {
        await startSession(await api.post<AuthTokens>('/auth/login', { email, password }))
      },
      async register(input) {
        await startSession(await api.post<AuthTokens>('/auth/register', { ...input, locale }))
      },
      async logout() {
        await api.post('/auth/logout').catch(() => {})
        endSession()
      },
      async updateMe(patch) {
        const user = await api.patch<Me>('/me', patch)
        saveOffline('me', user)
        setMe(user)
      },
      async deleteAccount() {
        await api.delete('/me')
        endSession()
      },
      async chooseFestival(id) {
        applyLoaded(await loadAccount(id))
      },
      async addTicket(ticketCode) {
        const before = new Set(festivals.map((f) => f.id))
        const list = await api.post<Festival[]>('/me/tickets', { ticketCode: ticketCode.trim().toUpperCase() })
        const added = list.find((f) => !before.has(f.id)) ?? null
        applyLoaded(await loadAccount(added?.id ?? festivalId ?? undefined))
        return added
      },
      setLocale(next) {
        setLocalLocale(next)
        try {
          localStorage.setItem('festivalapp.locale', next)
        } catch {
          /* niets */
        }
      },
    }),
    [status, me, festivals, festival, festivalId, realtime, online, live, dark, locale, startSession, endSession, applyLoaded],
  )

  return (
    <SessionContext.Provider value={value}>
      <I18nProvider locale={locale}>{children}</I18nProvider>
    </SessionContext.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export function useSession(): Session {
  const session = useContext(SessionContext)
  if (!session) throw new Error('useSession buiten SessionProvider')
  return session
}

/** Luister naar een realtime-event zolang het component bestaat. */
// eslint-disable-next-line react-refresh/only-export-components
export function useRealtime<T>(type: string, handler: (data: T) => void): void {
  const { realtime } = useSession()
  useEffect(() => {
    if (!realtime) return
    return realtime.on(type, (data) => handler(data as T))
  }, [realtime, type, handler])
}
