// Eenmalige tickets voor de WebSocket. De app vraagt met zijn access-token een ticket aan
// (POST /realtime/ticket) en verbindt daarna met /ws?ticket=…. Zo komt het access-token niet in
// een URL, en dus niet in de logs van Cloudflare, Caddy of de browser.
// Een ticket is 30 seconden geldig, werkt één keer en staat alleen als hash in het geheugen.
import { randomToken, sha256 } from './security.ts'

export const TICKET_SECONDS = 30
const MAX_TICKETS = 10_000

export interface TicketStore {
  /** `tokenExp` = verloopmoment van het access-token (seconden); de verbinding sluit dan */
  issue(user: { id: string; tokenExp: number }): string
  /** Geeft de gebruiker terug en maakt het ticket meteen ongeldig; null = onbekend, gebruikt of verlopen */
  redeem(ticket: string): { id: string; exp: number } | null
}

export function createTicketStore(now: () => number = Date.now): TicketStore {
  const tickets = new Map<string, { id: string; exp: number; expiresAt: number }>()

  function cleanup() {
    const time = now()
    for (const [hash, t] of tickets) if (t.expiresAt <= time) tickets.delete(hash)
  }

  return {
    issue(user) {
      if (tickets.size >= MAX_TICKETS) cleanup()
      const ticket = randomToken()
      tickets.set(sha256(ticket), { id: user.id, exp: user.tokenExp, expiresAt: now() + TICKET_SECONDS * 1000 })
      return ticket
    },
    redeem(ticket) {
      const hash = sha256(ticket)
      const entry = tickets.get(hash)
      tickets.delete(hash)
      if (!entry || entry.expiresAt <= now()) return null
      return { id: entry.id, exp: entry.exp }
    },
  }
}
