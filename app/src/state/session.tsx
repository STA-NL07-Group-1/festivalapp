// Sessie: ingelogde gebruiker, instellingen (thema/taal) en de realtime-verbinding.
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  api,
  clearTokens,
  hasStoredSession,
  setSessionEndedHandler,
  storeTokens,
  type AuthTokens,
  type Me,
} from '../api/client'
import { I18nProvider } from '../i18n'
import { detectLocale } from '../i18n/translate'
import type { Locale } from '../lib/format'
import { connectRealtime, type RealtimeConnection } from '../lib/realtime'

type Status = 'loading' | 'anonymous' | 'authenticated'

interface Session {
  status: Status
  me: Me | null
  realtime: RealtimeConnection | null
  online: boolean
  login(email: string, password: string): Promise<void>
  register(input: { ticketCode: string; email: string; password: string; displayName: string }): Promise<void>
  logout(): Promise<void>
  updateMe(patch: Partial<Pick<Me, 'displayName' | 'theme' | 'locale' | 'shareLocation' | 'shareTimetable'>>): Promise<void>
  deleteAccount(): Promise<void>
  setLocale(locale: Locale): void
}

const SessionContext = createContext<Session | null>(null)

function applyTheme(theme: Me['theme'] | undefined) {
  const dark =
    theme === 'donker' || ((theme ?? 'systeem') === 'systeem' && window.matchMedia?.('(prefers-color-scheme: dark)').matches)
  document.documentElement.dataset.theme = dark ? 'dark' : 'light'
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#0f0920' : '#f7f5fc')
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>(() => (hasStoredSession() ? 'loading' : 'anonymous'))
  const [me, setMe] = useState<Me | null>(null)
  const [localLocale, setLocalLocale] = useState<Locale>(detectLocale)
  const [realtime, setRealtime] = useState<RealtimeConnection | null>(null)
  const [online, setOnline] = useState(navigator.onLine)

  const locale: Locale = me?.locale ?? localLocale

  const endSession = useCallback(() => {
    clearTokens()
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
        setMe(user)
        setStatus('authenticated')
      })
      .catch(() => endSession())
  }, [status, endSession])

  // Realtime-verbinding zolang je bent ingelogd
  useEffect(() => {
    if (status !== 'authenticated') return
    const connection = connectRealtime()
    // Koppelen aan een extern systeem (WebSocket): hier hoort setState in een effect
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRealtime(connection)
    const offStatus = connection.onStatus(setOnline)
    return () => {
      offStatus()
      connection.close()
      setRealtime(null)
    }
  }, [status])

  useEffect(() => {
    const up = () => setOnline(true)
    const down = () => setOnline(false)
    window.addEventListener('online', up)
    window.addEventListener('offline', down)
    return () => {
      window.removeEventListener('online', up)
      window.removeEventListener('offline', down)
    }
  }, [])

  useEffect(() => {
    applyTheme(me?.theme)
    const media = window.matchMedia?.('(prefers-color-scheme: dark)')
    const listener = () => applyTheme(me?.theme)
    media?.addEventListener('change', listener)
    return () => media?.removeEventListener('change', listener)
  }, [me?.theme])

  useEffect(() => {
    document.documentElement.lang = locale
  }, [locale])

  const startSession = useCallback(async (tokens: AuthTokens) => {
    storeTokens(tokens)
    setMe(await api.get<Me>('/me'))
    setStatus('authenticated')
  }, [])

  const value = useMemo<Session>(
    () => ({
      status,
      me,
      realtime,
      online,
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
        setMe(await api.patch<Me>('/me', patch))
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
    [status, me, realtime, online, locale, startSession, endSession],
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
