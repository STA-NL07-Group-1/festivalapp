import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '../api/client'
import { connectRealtime, CONNECT_TIMEOUT_MS, DEAD_AFTER_MS, PING_EVERY_MS } from './realtime'

vi.mock('../api/client', async (importOriginal) => {
  const real = await importOriginal<typeof import('../api/client')>()
  return { ...real, api: { ...real.api, post: vi.fn() } }
})

/** Nep-WebSocket: wij bepalen zelf wanneer hij opent of iets ontvangt */
class FakeSocket {
  static OPEN = 1
  static all: FakeSocket[] = []
  readyState = 0
  sent: string[] = []
  closed = false
  onopen: (() => void) | null = null
  onmessage: ((event: { data: string }) => void) | null = null
  onclose: (() => void) | null = null
  url: string
  constructor(url: string) {
    this.url = url
    FakeSocket.all.push(this)
  }
  send(data: string) {
    this.sent.push(data)
  }
  close() {
    this.closed = true
    this.readyState = 3
  }
  open() {
    this.readyState = 1
    this.onopen?.()
  }
  receive(type: string) {
    this.onmessage?.({ data: JSON.stringify({ type, data: {} }) })
  }
}

const post = vi.mocked(api.post)
// Ticket ophalen is een promise: even laten afhandelen
const flush = () => vi.advanceTimersByTimeAsync(0)

beforeEach(() => {
  vi.useFakeTimers()
  FakeSocket.all = []
  vi.stubGlobal('WebSocket', FakeSocket)
  post.mockResolvedValue({ ticket: 't', expiresIn: 30 })
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('connectRealtime', () => {
  it('verbindt opnieuw als er te lang niets binnenkomt (half open verbinding)', async () => {
    const connection = connectRealtime()
    const status: boolean[] = []
    connection.onStatus((online) => status.push(online))
    await flush()
    FakeSocket.all[0]!.open()
    expect(status).toEqual([true])

    // Geen pong meer: na DEAD_AFTER_MS ziet de ping-timer dat de verbinding dood is
    await vi.advanceTimersByTimeAsync(DEAD_AFTER_MS + PING_EVERY_MS)
    expect(FakeSocket.all[0]!.closed).toBe(true)
    expect(status).toEqual([true, false])

    // Daarna een nieuwe verbinding
    await vi.advanceTimersByTimeAsync(1000)
    expect(FakeSocket.all).toHaveLength(2)
    connection.close()
  })

  it('blijft verbonden zolang er pongs binnenkomen', async () => {
    const connection = connectRealtime()
    await flush()
    const socket = FakeSocket.all[0]!
    socket.open()
    for (let i = 0; i < 5; i++) {
      await vi.advanceTimersByTimeAsync(PING_EVERY_MS)
      socket.receive('pong')
    }
    expect(socket.closed).toBe(false)
    expect(FakeSocket.all).toHaveLength(1)
    connection.close()
  })

  it('meldt de server of de app in beeld is, zodat die weet of er een pushmelding moet komen', async () => {
    const connection = connectRealtime()
    await flush()
    const socket = FakeSocket.all[0]!
    socket.open()
    const visibility = () => socket.sent.map((m) => JSON.parse(m)).filter((m) => m.type === 'visibility').map((m) => m.data.visible)
    expect(visibility()).toEqual([true])

    // De app gaat naar de achtergrond en komt terug
    let state: DocumentVisibilityState = 'hidden'
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state })
    document.dispatchEvent(new Event('visibilitychange'))
    expect(visibility()).toEqual([true, false])
    state = 'visible'
    document.dispatchEvent(new Event('visibilitychange'))
    expect(visibility()).toEqual([true, false, true])
    // Weer de echte waarde van jsdom (van Document.prototype)
    delete (document as { visibilityState?: unknown }).visibilityState
    connection.close()
  })

  it('probeert opnieuw als verbinden blijft hangen', async () => {
    const connection = connectRealtime()
    await flush()
    await vi.advanceTimersByTimeAsync(CONNECT_TIMEOUT_MS)
    expect(FakeSocket.all[0]!.closed).toBe(true)
    await vi.advanceTimersByTimeAsync(1000)
    expect(FakeSocket.all).toHaveLength(2)
    connection.close()
  })
})
