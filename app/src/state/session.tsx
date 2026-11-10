// Sessie: ingelogde gebruiker, instellingen (thema/taal) en de realtime-verbinding.
import { createContext, useCallback, useContext, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react'
import {
  api,
  ApiError,
  clearTokens,
  hasStoredSession,
  isNetworkOnline,
  onNetworkChange,
  setNetworkOnline,
  setSessionEndedHandler,
  storeTokens,
  type AuthTokens,
  type Me,
} from '../api/client'
import { I18nProvider } from '../i18n'
import { detectLocale } from '../i18n/translate'
import type { Locale } from '../lib/format'
import { clearOffline, loadOffline, saveOffline } from '../lib/offlineStore'
import { connectRealtime, type RealtimeConnection } from '../lib/realtime'

type Status = 'loading' | 'anonymous' | 'authenticated'

interface Session {
  status: Status
  me: Me | null
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
  const [localLocale, setLocalLocale] = useState<Locale>(detectLocale)
  const [realtime, setRealtime] = useState<RealtimeConnection | null>(null)
  const [online, setOnline] = useState(isNetworkOnline)
  const [live, setLive] = useState(false)

  const locale: Locale = me?.locale ?? localLocale
  const prefersDark = usePrefersDark()
  const dark = me?.theme === 'donker' || (me?.theme !== 'licht' && prefersDark)

  const endSession = useCallback(() => {
    clearTokens()
    clearOffline()
    setMe(null)
    setStatus('anonymous')
  }, [])

  useEffect(() => setSessionEndedHandler(endSession), [endSession])

  // Bij het opstarten: bestaande sessie herstellen
  useEffect(() => {
    if (status !== 'loading') return
    api
      .get<Me>('/me')
      .then((user) => {
        saveOffline('me', user)
        setMe(user)
        setStatus('authenticated')
      })
      .catch((error: unknown) => {
        // Zonder internet: niet uitloggen, maar verder met het bewaarde account
        const stored = loadOffline<Me>('me')
        if (error instanceof ApiError && error.status === 0 && stored) {
          setMe(stored.data)
          setStatus('authenticated')
          return
        }
        endSession()
      })
  }, [status, endSession])

  // Realtime-verbinding zolang je bent ingelogd
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
  }, [status])

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

  const startSession = useCallback(async (tokens: AuthTokens) => {
    storeTokens(tokens)
    const user = await api.get<Me>('/me')
    saveOffline('me', user)
    setMe(user)
    setStatus('authenticated')
  }, [])

  const value = useMemo<Session>(
    () => ({
      status,
      me,
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
      setLocale(next) {
        setLocalLocale(next)
        try {
          localStorage.setItem('festivalapp.locale', next)
        } catch {
          /* niets */
        }
      },
    }),
    [status, me, realtime, online, live, dark, locale, startSession, endSession],
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
