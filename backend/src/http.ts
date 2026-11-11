// Kleine router en hulpfuncties rond node:http. Bewust zonder framework:
// weinig dependencies, en alles wat met beveiliging te maken heeft staat hier op één plek.
import type { IncomingMessage, ServerResponse } from 'node:http'

/** Rol binnen één festival */
export type FestivalRole = 'beheerder' | 'organisatie' | 'ehbo' | 'beveiliging'
/** Rol in het festival van dit verzoek. Wie alleen een ticket heeft, is bezoeker. */
export type Role = 'bezoeker' | FestivalRole
/** Rol over alle festivals heen */
export type PlatformRole = 'eigenaar' | 'sudo'

/** Iedereen die in het beheerportal mag */
export const STAFF: Role[] = ['beheerder', 'organisatie', 'ehbo', 'beveiliging']
/** Wie het programma, de kaart en de bezoekers van een festival beheert */
export const ORGANISERS: Role[] = ['beheerder', 'organisatie']

export interface AuthUser {
  id: string
  /** Rol in het festival van dit verzoek */
  role: Role
  platformRole: PlatformRole | null
}

export interface Context {
  req: IncomingMessage
  res: ServerResponse
  params: Record<string, string>
  query: URLSearchParams
  body: unknown
  user: AuthUser | null
  /** Het festival van dit verzoek; null als de gebruiker (nog) bij geen enkel festival hoort */
  festivalId: string | null
  deviceId: string | null
  ip: string
}

export interface Reply {
  status: number
  body?: unknown
  headers?: Record<string, string>
}

export type Handler = (ctx: Context) => Promise<Reply> | Reply

export interface RouteOptions {
  /** operationId uit api.yaml: daarmee wordt de body gevalideerd */
  operationId: string
  /** 'user' (standaard), 'none' of 'iot' */
  auth?: 'user' | 'none' | 'iot'
  /** Rol in het festival van dit verzoek */
  roles?: Role[]
  /** Alleen voor deze rollen over alle festivals heen (eigenaar, sudo) */
  platform?: PlatformRole[]
  /** Rate limit: maximaal `limit` verzoeken per `windowMs`, per gebruiker of IP */
  rateLimit?: { limit: number; windowMs: number }
  /** Grotere body toestaan dan de standaard 100 kB (bijv. voor een afbeelding) */
  maxBodyBytes?: number
}

export interface Route extends RouteOptions {
  method: string
  pattern: string
  regex: RegExp
  paramNames: string[]
  handler: Handler
}

export class HttpError extends Error {
  readonly status: number
  readonly code: string
  readonly headers: Record<string, string>
  constructor(status: number, code: string, message: string, headers: Record<string, string> = {}) {
    super(message)
    this.status = status
    this.code = code
    this.headers = headers
  }
}

export const badRequest = (message: string) => new HttpError(400, 'validation_failed', message)
export const unauthorized = (message = 'Log opnieuw in.') =>
  new HttpError(401, 'unauthorized', message, { 'WWW-Authenticate': 'Bearer' })
export const forbidden = (message = 'Je hebt geen toegang tot deze functie.') => new HttpError(403, 'forbidden', message)
export const notFound = (message = 'Niet gevonden.') => new HttpError(404, 'not_found', message)
export const conflict = (message: string) => new HttpError(409, 'conflict', message)

export class Router {
  readonly routes: Route[] = []

  add(method: string, pattern: string, options: RouteOptions, handler: Handler): void {
    const paramNames: string[] = []
    // eslint-disable-next-line security/detect-non-literal-regexp -- patronen komen uit onze eigen code, niet van gebruikers
    const regex = new RegExp(
      '^' +
        pattern.replace(/:([a-zA-Z]+)/g, (_, name: string) => {
          paramNames.push(name)
          return '([^/]+)'
        }) +
        '$',
    )
    this.routes.push({ method, pattern, regex, paramNames, handler, ...options })
    // Vaste paden vóór paden met parameters (/friends/locations vóór /friends/:userId)
    this.routes.sort((a, b) => a.paramNames.length - b.paramNames.length)
  }

  get = (p: string, o: RouteOptions, h: Handler) => this.add('GET', p, o, h)
  post = (p: string, o: RouteOptions, h: Handler) => this.add('POST', p, o, h)
  put = (p: string, o: RouteOptions, h: Handler) => this.add('PUT', p, o, h)
  patch = (p: string, o: RouteOptions, h: Handler) => this.add('PATCH', p, o, h)
  delete = (p: string, o: RouteOptions, h: Handler) => this.add('DELETE', p, o, h)

  match(method: string, path: string): { route: Route; params: Record<string, string> } | { allowed: string[] } | null {
    const candidates = this.routes.filter((r) => r.regex.test(path))
    if (candidates.length === 0) return null
    const route = candidates.find((r) => r.method === method)
    if (!route) return { allowed: [...new Set(candidates.map((r) => r.method))] }
    const values = route.regex.exec(path)?.slice(1) ?? []
    const params: Record<string, string> = {}
    route.paramNames.forEach((name, i) => {
      params[name] = decodeURIComponent(values[i] ?? '')
    })
    return { route, params }
  }
}

const MAX_BODY_BYTES = 100_000

export async function readJsonBody(req: IncomingMessage, maxBytes = MAX_BODY_BYTES): Promise<unknown> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    size += (chunk as Buffer).length
    if (size > maxBytes) throw new HttpError(413, 'validation_failed', 'Verzoek is te groot.')
    chunks.push(chunk as Buffer)
  }
  if (size === 0) return undefined
  const type = req.headers['content-type'] ?? ''
  if (!type.toLowerCase().startsWith('application/json')) {
    throw new HttpError(415, 'validation_failed', 'Stuur JSON (Content-Type: application/json).')
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw badRequest('Ongeldige JSON.')
  }
}

export function sendJson(res: ServerResponse, status: number, body?: unknown, headers: Record<string, string> = {}): void {
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v)
  res.statusCode = status
  if (body === undefined || status === 204) {
    res.end()
    return
  }
  // Binaire inhoud (bijv. de plattegrond): de route zet zelf Content-Type
  if (Buffer.isBuffer(body)) {
    res.end(body)
    return
  }
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(body))
}

export function setSecurityHeaders(res: ServerResponse): void {
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('X-Frame-Options', 'DENY')
  res.setHeader('Referrer-Policy', 'no-referrer')
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'")
  res.setHeader('Cross-Origin-Resource-Policy', 'same-site')
}

/** Vaste-venster rate limiter in het geheugen (genoeg voor één server). */
export class RateLimiter {
  private readonly hits = new Map<string, { count: number; resetAt: number }>()

  check(key: string, limit: number, windowMs: number): number | null {
    const now = Date.now()
    const entry = this.hits.get(key)
    if (!entry || entry.resetAt <= now) {
      this.hits.set(key, { count: 1, resetAt: now + windowMs })
      if (this.hits.size > 50_000) this.prune(now)
      return null
    }
    entry.count++
    if (entry.count > limit) return Math.ceil((entry.resetAt - now) / 1000)
    return null
  }

  private prune(now: number): void {
    for (const [key, entry] of this.hits) if (entry.resetAt <= now) this.hits.delete(key)
  }
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function uuidParam(ctx: Context, name: string): string {
  const value = ctx.params[name] ?? ''
  if (!UUID_RE.test(value)) throw notFound()
  return value
}

export function requireUser(ctx: Context): AuthUser {
  if (!ctx.user) throw unauthorized()
  return ctx.user
}

export function requireFestival(ctx: Context): string {
  if (!ctx.festivalId) throw forbidden('Je hoort nog bij geen festival. Voeg eerst een ticket toe.')
  return ctx.festivalId
}
