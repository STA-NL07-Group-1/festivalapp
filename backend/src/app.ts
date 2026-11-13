// Bouwt de HTTP-handler: CORS → route zoeken → rate limit → authenticatie →
// autorisatie → body valideren → handler. Fouten worden nooit met details gelekt.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { Config } from './config.ts'
import type { Db } from './db.ts'
import {
  HttpError,
  RateLimiter,
  Router,
  UUID_RE,
  badRequest,
  forbidden,
  readJsonBody,
  sendJson,
  setSecurityHeaders,
  unauthorized,
  type Context,
} from './http.ts'
import { loadAccess, pickFestival } from './festival.ts'
import { createMailer, type Mailer } from './mail.ts'
import type { Push } from './push.ts'
import { noRealtime, type Realtime } from './realtime.ts'
import { createTicketStore, type TicketStore } from './wsTickets.ts'
import { sha256, verifyAccessToken } from './security.ts'
import { knownOperation, validateBody } from './validation.ts'
import { registerRoutes } from './routes/index.ts'

export interface Deps {
  db: Db
  config: Config
  push: Push
  mailer: Mailer
  /** Wordt na het starten van de server ingevuld */
  realtime: Realtime
  limiter: RateLimiter
  /** Eenmalige tickets voor /ws (zie wsTickets.ts) */
  wsTickets: TicketStore
}

function clientIp(req: IncomingMessage): string {
  // Achter Cloudflare: TRUST_PROXY=cloudflare gebruikt het IP dat Cloudflare doorgeeft.
  // Laat dan alleen Cloudflare-IP's toe op poort 80/443, anders is deze header te vervalsen.
  if (process.env.TRUST_PROXY === 'cloudflare') {
    const cf = req.headers['cf-connecting-ip']
    if (typeof cf === 'string' && cf) return cf.trim()
  }
  // Achter een andere proxy: TRUST_PROXY=1 gebruikt X-Forwarded-For
  if (process.env.TRUST_PROXY === '1') {
    const forwarded = req.headers['x-forwarded-for']
    if (typeof forwarded === 'string') return forwarded.split(',')[0]!.trim()
  }
  return req.socket.remoteAddress ?? 'onbekend'
}

export function createApp(
  deps: Omit<Deps, 'realtime' | 'limiter' | 'mailer' | 'wsTickets'> & Partial<Pick<Deps, 'realtime' | 'limiter' | 'mailer' | 'wsTickets'>>,
) {
  const fullDeps: Deps = {
    realtime: noRealtime,
    limiter: new RateLimiter(),
    mailer: createMailer(deps.config.mail),
    wsTickets: createTicketStore(),
    ...deps,
  }
  const router = new Router()
  registerRoutes(router, fullDeps)

  for (const route of router.routes) {
    if (!knownOperation(route.operationId)) throw new Error(`operationId ${route.operationId} staat niet in api.yaml`)
  }

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    setSecurityHeaders(res)
    const origin = req.headers.origin
    if (origin && fullDeps.config.corsOrigins.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin)
      res.setHeader('Vary', 'Origin')
      res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-Device-Key, X-Festival-Id')
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE')
      res.setHeader('Access-Control-Max-Age', '600')
    }
    if (req.method === 'OPTIONS') return sendJson(res, 204)

    const url = new URL(req.url ?? '/', 'http://localhost')
    const match = router.match(req.method ?? 'GET', url.pathname)
    if (!match) return sendJson(res, 404, { error: 'not_found', message: 'Niet gevonden.' })
    if ('allowed' in match) {
      return sendJson(res, 405, { error: 'not_found', message: 'Methode niet toegestaan.' }, { Allow: match.allowed.join(', ') })
    }
    const { route, params } = match
    const ip = clientIp(req)

    const ctx: Context = { req, res, params, query: url.searchParams, body: undefined, user: null, festivalId: null, deviceId: null, ip }

    // Authenticatie
    const auth = route.auth ?? 'user'
    // eslint-disable-next-line security/detect-possible-timing-attacks -- vergelijkt de route-instelling, geen geheim
    if (auth === 'user') {
      const token = /^Bearer\s+(\S+)$/i.exec(req.headers.authorization ?? '')?.[1]
      if (!token) throw unauthorized()
      let userId: string
      let tokenExp: number
      try {
        const payload = await verifyAccessToken(token, fullDeps.config.jwtSecret)
        userId = payload.id
        tokenExp = payload.exp
      } catch {
        throw unauthorized()
      }
      // Rol en festival komen uit de database, niet uit het token: zo werkt een nieuwe rol,
      // een blokkade of een afgelopen festival direct
      const access = await loadAccess(fullDeps.db, userId)
      if (!access || access.blocked) throw unauthorized()
      const header = req.headers['x-festival-id']
      const requested = typeof header === 'string' && header ? header : null
      if (requested && !UUID_RE.test(requested)) throw badRequest('Onbekend festival.')
      const festival = pickFestival(access, requested)
      ctx.festivalId = festival?.id ?? null
      ctx.user = { id: userId, role: festival?.role ?? 'bezoeker', platformRole: access.platformRole, tokenExp }
      // eslint-disable-next-line security/detect-possible-timing-attacks -- idem; de sleutel zelf wordt gehasht vergeleken
    } else if (auth === 'iot') {
      const key = req.headers['x-device-key']
      const deviceId = typeof key === 'string' ? fullDeps.config.iotDeviceKeys.get(sha256(key)) : undefined
      if (!deviceId) throw new HttpError(401, 'unauthorized', 'Onbekend apparaat.')
      ctx.deviceId = deviceId
    }

    // Rate limiting (na authenticatie, zodat we per gebruiker kunnen tellen)
    if (route.rateLimit) {
      const who = ctx.user?.id ?? ctx.deviceId ?? ip
      const retryAfter = fullDeps.limiter.check(`${route.operationId}:${who}`, route.rateLimit.limit, route.rateLimit.windowMs)
      if (retryAfter !== null) {
        throw new HttpError(429, 'rate_limited', 'Te veel pogingen. Probeer het later opnieuw.', {
          'Retry-After': String(retryAfter),
        })
      }
    }

    // Autorisatie
    if (route.roles && (!ctx.user || !ctx.festivalId || !route.roles.includes(ctx.user.role))) throw forbidden()
    if (route.platform && (!ctx.user?.platformRole || !route.platform.includes(ctx.user.platformRole))) throw forbidden()

    ctx.body = await readJsonBody(req, route.maxBodyBytes)
    validateBody(route.operationId, ctx.body)

    const reply = await route.handler(ctx)
    sendJson(res, reply.status, reply.body, reply.headers)
  }

  const handler = async (req: IncomingMessage, res: ServerResponse) => {
    try {
      await handle(req, res)
    } catch (error) {
      if (res.headersSent) return res.destroy()
      if (error instanceof HttpError) {
        return sendJson(res, error.status, { error: error.code, message: error.message }, error.headers)
      }
      console.error('[api] onverwachte fout', error)
      sendJson(res, 500, { error: 'internal', message: 'Er ging iets mis. Probeer het opnieuw.' })
    }
  }

  return { handler, deps: fullDeps }
}

export function createHttpServer(handler: ReturnType<typeof createApp>['handler']): Server {
  const server = createServer({ requestTimeout: 15_000, headersTimeout: 10_000 }, (req, res) => {
    void handler(req, res)
  })
  return server
}
