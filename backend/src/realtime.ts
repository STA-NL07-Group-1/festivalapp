// WebSocket-hub. De client verbindt met /ws?token=<access-token>&festival=<festival-id>.
// Zonder festival kiest de server het meest logische festival, net als bij de API.
// Clients sturen alleen "ping"; alle wijzigingen lopen via REST, zodat
// autorisatie op één plek zit. De server stuurt events als { type, data }.
import type { IncomingMessage, Server } from 'node:http'
import { WebSocketServer, type WebSocket } from 'ws'
import { UUID_RE, type Role } from './http.ts'
import { verifyAccessToken } from './security.ts'

export interface Realtime {
  toUser(userId: string, type: string, data: unknown): void
  /** Met festivalId: alleen verbindingen die op dat moment bij dat festival kijken */
  toUsers(userIds: Iterable<string>, type: string, data: unknown, festivalId?: string): void
  /** Al het personeel van één festival (beheerder, organisatie, EHBO, beveiliging) */
  toStaff(festivalId: string, type: string, data: unknown): void
  /** Iedereen die bij één festival kijkt */
  toFestival(festivalId: string, type: string, data: unknown): void
  isOnline(userId: string): boolean
  close(): void
}

/** Festival en rol van een verbinding; null = geen toegang (geblokkeerd, of geen toegang tot het gevraagde festival) */
export type ResolveSocket = (userId: string, festivalId: string | null) => Promise<{ festivalId: string | null; role: Role } | null>

interface Client {
  socket: WebSocket
  userId: string
  // Staat vast zolang de verbinding open is. De verbinding sluit als het token verloopt
  // (na een kwartier), dus een nieuwe rol of blokkade werkt hier uiterlijk dan.
  festivalId: string | null
  role: Role
  alive: boolean
}

/** Een hub zonder verbindingen (voor tests en scripts) */
export const noRealtime: Realtime = {
  toUser() {},
  toUsers() {},
  toStaff() {},
  toFestival() {},
  isOnline: () => false,
  close() {},
}

const MAX_SOCKETS_PER_USER = 5

export function attachRealtime(
  server: Server,
  options: { jwtSecret: Uint8Array; corsOrigins: string[]; resolve: ResolveSocket },
): Realtime {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 1024 })
  const clients = new Map<string, Set<Client>>()

  server.on('upgrade', (req: IncomingMessage, socket, head) => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    const reject = (status: number) => {
      socket.write(`HTTP/1.1 ${status} ${status === 401 ? 'Unauthorized' : 'Forbidden'}\r\n\r\n`)
      socket.destroy()
    }
    if (url.pathname !== '/ws') return reject(403)
    const origin = req.headers.origin
    if (origin && !options.corsOrigins.includes(origin)) return reject(403)

    const festival = url.searchParams.get('festival')
    if (festival && !UUID_RE.test(festival)) return reject(403)

    verifyAccessToken(url.searchParams.get('token') ?? '', options.jwtSecret)
      .then(async (user) => {
        // Zelfde regels als bij de API: geblokkeerd of geen toegang tot dit festival → geen verbinding
        const access = await options.resolve(user.id, festival).catch(() => null)
        if (!access) return reject(403)
        if ((clients.get(user.id)?.size ?? 0) >= MAX_SOCKETS_PER_USER) return reject(403)
        wss.handleUpgrade(req, socket, head, (ws) => register(ws, user, access))
      })
      .catch(() => reject(401))
  })

  function register(socket: WebSocket, user: { id: string; exp: number }, access: { festivalId: string | null; role: Role }) {
    const client: Client = { socket, userId: user.id, festivalId: access.festivalId, role: access.role, alive: true }
    if (!clients.has(user.id)) clients.set(user.id, new Set())
    clients.get(user.id)!.add(client)

    // Verbinding sluiten zodra het token verloopt; de app verbindt opnieuw met een nieuw token
    const expiresIn = Math.max(user.exp * 1000 - Date.now(), 0)
    const expiry = setTimeout(() => socket.close(4001, 'token verlopen'), expiresIn)

    socket.on('pong', () => {
      client.alive = true
    })
    socket.on('message', (raw) => {
      let message: { type?: unknown } | null
      try {
        message = JSON.parse(raw.toString()) as { type?: unknown }
      } catch {
        return
      }
      if (message?.type === 'ping') socket.send(JSON.stringify({ type: 'pong', data: {} }))
    })
    socket.on('close', () => {
      clearTimeout(expiry)
      const set = clients.get(user.id)
      set?.delete(client)
      if (set && set.size === 0) clients.delete(user.id)
    })
    socket.send(JSON.stringify({ type: 'hello', data: { userId: user.id } }))
  }

  const heartbeat = setInterval(() => {
    for (const set of clients.values()) {
      for (const client of set) {
        if (!client.alive) {
          client.socket.terminate()
          continue
        }
        client.alive = false
        client.socket.ping()
      }
    }
  }, 30_000)

  const send = (client: Client, payload: string) => {
    if (client.socket.readyState === client.socket.OPEN) client.socket.send(payload)
  }

  return {
    toUser(userId, type, data) {
      const payload = JSON.stringify({ type, data })
      for (const client of clients.get(userId) ?? []) send(client, payload)
    },
    toUsers(userIds, type, data, festivalId) {
      const payload = JSON.stringify({ type, data })
      for (const id of userIds)
        for (const client of clients.get(id) ?? []) if (!festivalId || client.festivalId === festivalId) send(client, payload)
    },
    toStaff(festivalId, type, data) {
      const payload = JSON.stringify({ type, data })
      for (const set of clients.values())
        for (const client of set) if (client.festivalId === festivalId && client.role !== 'bezoeker') send(client, payload)
    },
    toFestival(festivalId, type, data) {
      const payload = JSON.stringify({ type, data })
      for (const set of clients.values()) for (const client of set) if (client.festivalId === festivalId) send(client, payload)
    },
    isOnline: (userId) => (clients.get(userId)?.size ?? 0) > 0,
    close() {
      clearInterval(heartbeat)
      for (const set of clients.values()) for (const client of set) client.socket.close(1001)
      wss.close()
    },
  }
}
