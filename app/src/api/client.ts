// API-client met automatisch vernieuwen van het access-token.
// - Access-token: alleen in het geheugen (weg na sluiten van het tabblad).
// - Refresh-token: in localStorage, zodat je ingelogd blijft. Wordt bij elk gebruik vervangen.
import type { components } from './schema'

export type Schemas = components['schemas']
export type Me = Schemas['Me']
export type Friend = Schemas['Friend']
export type FriendLocation = Schemas['FriendLocation']
export type Pin = Schemas['Pin']
export type Message = Schemas['Message']
export type Stage = Schemas['Stage']
export type MapPoint = Schemas['MapPoint']
export type MapPointKind = Schemas['MapPointKind']
export type Performance = Schemas['Performance']
export type Signup = Schemas['Signup']
export type CrowdLevel = Schemas['CrowdLevel']
export type Announcement = Schemas['Announcement']
export type SosAlert = Schemas['SosAlert']
export type FriendCode = Schemas['FriendCode']
export type AuthTokens = Schemas['AuthTokens']

export const API_URL = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') ?? 'http://localhost:3000'

const REFRESH_KEY = 'festivalapp.refreshToken'

export class ApiError extends Error {
  readonly status: number
  readonly code: string
  constructor(status: number, code: string, message: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

// Of de server bereikbaar is. navigator.onLine zegt alleen of er een netwerk is, niet of er
// echt internet is (op een druk festivalterrein heb je vaak wel bereik maar geen data).
// Daarom kijken we ook naar het resultaat van onze eigen verzoeken.
let networkOnline = typeof navigator === 'undefined' ? true : navigator.onLine
const networkListeners = new Set<(online: boolean) => void>()

export function isNetworkOnline(): boolean {
  return networkOnline
}

export function onNetworkChange(listener: (online: boolean) => void): () => void {
  networkListeners.add(listener)
  return () => networkListeners.delete(listener)
}

export function setNetworkOnline(online: boolean): void {
  if (online === networkOnline) return
  networkOnline = online
  for (const listener of networkListeners) listener(online)
}

let accessToken: string | null = null
let refreshing: Promise<boolean> | null = null
let onSessionEnded: () => void = () => {}

export function setSessionEndedHandler(handler: () => void): void {
  onSessionEnded = handler
}

function readRefreshToken(): string | null {
  try {
    return localStorage.getItem(REFRESH_KEY)
  } catch {
    return null
  }
}

export function storeTokens(tokens: AuthTokens): void {
  accessToken = tokens.accessToken
  try {
    localStorage.setItem(REFRESH_KEY, tokens.refreshToken)
  } catch {
    // privémodus: dan blijf je alleen in dit tabblad ingelogd
  }
}

export function clearTokens(): void {
  accessToken = null
  try {
    localStorage.removeItem(REFRESH_KEY)
  } catch {
    /* niets */
  }
}

export const hasStoredSession = () => readRefreshToken() !== null

function tokenExpiresSoon(token: string): boolean {
  try {
    const payload = JSON.parse(atob(token.split('.')[1]!.replace(/-/g, '+').replace(/_/g, '/'))) as { exp?: number }
    return !payload.exp || payload.exp * 1000 - Date.now() < 30_000
  } catch {
    return true
  }
}

/** Vraagt één keer tegelijk een nieuw token aan. */
async function refresh(): Promise<boolean> {
  const refreshToken = readRefreshToken()
  if (!refreshToken) return false
  refreshing ??= (async () => {
    try {
      const res = await fetch(`${API_URL}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      })
      if (!res.ok) {
        if (res.status === 401) {
          clearTokens()
          onSessionEnded()
        }
        return false
      }
      storeTokens((await res.json()) as AuthTokens)
      return true
    } catch {
      setNetworkOnline(false)
      return false
    } finally {
      refreshing = null
    }
  })()
  return refreshing
}

/** Geldig access-token (vernieuwt indien nodig). Voor de WebSocket. */
export async function getAccessToken(): Promise<string | null> {
  if (accessToken && !tokenExpiresSoon(accessToken)) return accessToken
  return (await refresh()) ? accessToken : null
}

export async function request<T = void>(method: string, path: string, body?: unknown, retried = false): Promise<T> {
  const headers: Record<string, string> = {}
  const publicRoute = path.startsWith('/auth/') && path !== '/auth/logout'
  if (!publicRoute) {
    const token = await getAccessToken()
    if (token) headers.Authorization = `Bearer ${token}`
  }
  if (body !== undefined) headers['Content-Type'] = 'application/json'

  let res: Response
  try {
    res = await fetch(`${API_URL}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch {
    setNetworkOnline(false)
    throw new ApiError(0, 'offline', 'offline')
  }
  setNetworkOnline(true)

  if (res.status === 401 && !publicRoute && !retried && (await refresh())) {
    return request<T>(method, path, body, true)
  }
  if (!res.ok) {
    let error = { error: 'internal', message: res.statusText }
    try {
      error = (await res.json()) as typeof error
    } catch {
      /* geen JSON */
    }
    throw new ApiError(res.status, error.error, error.message)
  }
  if (res.status === 204 || res.headers.get('content-length') === '0') return undefined as T
  const text = await res.text()
  return (text ? JSON.parse(text) : undefined) as T
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T = void>(path: string, body?: unknown) => request<T>('POST', path, body),
  put: <T = void>(path: string, body?: unknown) => request<T>('PUT', path, body),
  patch: <T = void>(path: string, body?: unknown) => request<T>('PATCH', path, body),
  delete: <T = void>(path: string, body?: unknown) => request<T>('DELETE', path, body),
}
