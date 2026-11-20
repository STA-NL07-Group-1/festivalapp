import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api, ApiError, setFestival } from '../api/client'
import { deliver, deliverPin, enqueue, enqueuePin, flushOutbox, removeFromOutbox } from './outbox'
import { loadOffline, saveOffline } from './offlineStore'

vi.mock('../api/client', async (importOriginal) => {
  const real = await importOriginal<typeof import('../api/client')>()
  return { ...real, api: { ...real.api, post: vi.fn() } }
})

const post = vi.mocked(api.post)
const stored = () => loadOffline<{ clientId: string }[]>('outbox')?.data ?? []
const message = (body: string, clientId: string) => ({
  id: 'm1',
  senderId: 'ik',
  recipientId: 'vriend',
  body,
  createdAt: new Date().toISOString(),
  clientId,
})

describe('wachtrij voor chatberichten', () => {
  beforeEach(() => {
    post.mockReset()
  })

  it('bewaart een bericht op de telefoon tot de server het heeft, met een eigen clientId', async () => {
    const item = enqueue('vriend', 'Waar sta je?')
    expect(stored()).toHaveLength(1)
    post.mockResolvedValueOnce(message('Waar sta je?', item.clientId))
    await deliver(item)
    expect(post).toHaveBeenCalledWith('/messages/vriend', { body: 'Waar sta je?', clientId: item.clientId })
    expect(stored()).toHaveLength(0)
  })

  it('zonder bereik blijft het bericht staan; een nieuwe poging gebruikt hetzelfde clientId', async () => {
    const item = enqueue('vriend', 'Hallo?')
    post.mockRejectedValueOnce(new ApiError(0, 'offline', 'offline'))
    await expect(deliver(item)).rejects.toThrow()
    expect(stored()).toHaveLength(1)

    post.mockResolvedValueOnce(message('Hallo?', item.clientId))
    await flushOutbox()
    expect(post).toHaveBeenLastCalledWith('/messages/vriend', { body: 'Hallo?', clientId: item.clientId })
    expect(stored()).toHaveLength(0)
  })

  it('weigert de server het voorgoed (geen vrienden meer), dan gaat het uit de wachtrij', async () => {
    const item = enqueue('vreemde', 'Hoi')
    post.mockRejectedValueOnce(new ApiError(404, 'not_found', 'Niet gevonden.'))
    await expect(deliver(item)).rejects.toThrow()
    expect(stored()).toHaveLength(0)
  })

  it('verdwijnt als hetzelfde bericht via de WebSocket binnenkomt', () => {
    const item = enqueue('vriend', 'Kom je?')
    removeFromOutbox(item.clientId)
    expect(stored()).toHaveLength(0)
  })
})

describe('wachtrij voor pins', () => {
  const pin = { label: 'Bij de bar', latitude: 52.38, longitude: 4.87, visibility: 'vrienden' as const }
  const saved = (clientId: string) => ({ id: 'p1', userId: 'ik', ...pin, createdAt: new Date().toISOString(), clientId })

  beforeEach(() => {
    post.mockReset()
    setFestival('festival-a')
  })

  it('zonder bereik blijft de pin staan en gaat hij later met hetzelfde clientId', async () => {
    const item = enqueuePin(pin)
    expect(item.festivalId).toBe('festival-a')
    post.mockRejectedValueOnce(new ApiError(0, 'offline', 'offline'))
    await expect(deliverPin(item)).rejects.toThrow()
    expect(stored()).toHaveLength(1)

    post.mockResolvedValueOnce(saved(item.clientId))
    await flushOutbox()
    expect(post).toHaveBeenLastCalledWith('/pins', { ...pin, clientId: item.clientId })
    expect(stored()).toHaveLength(0)
  })

  it('een pin van een ander festival wacht, en houdt berichten erachter niet tegen', async () => {
    const item = enqueuePin(pin)
    setFestival('festival-b')
    const chat = enqueue('vriend', 'Ik heb een pin gezet')
    post.mockResolvedValueOnce(message('Ik heb een pin gezet', chat.clientId))
    await flushOutbox()
    expect(post).toHaveBeenCalledTimes(1)
    expect(stored().map((i) => i.clientId)).toEqual([item.clientId])
    removeFromOutbox(item.clientId)
  })

  it('na een lege wachtrij blijft versturen werken (de wachtrij raakt niet vast)', async () => {
    await flushOutbox()
    await flushOutbox()
    const item = enqueuePin(pin)
    post.mockResolvedValueOnce(saved(item.clientId))
    await flushOutbox()
    expect(post).toHaveBeenCalledWith('/pins', { ...pin, clientId: item.clientId })
    expect(stored()).toHaveLength(0)
  })

  it('oude berichten in de wachtrij (zonder kind) gaan gewoon als bericht', async () => {
    saveOffline('outbox', [{ clientId: 'oud-1', friendId: 'vriend', body: 'Van vóór de update', createdAt: new Date().toISOString() }])
    post.mockResolvedValueOnce(message('Van vóór de update', 'oud-1'))
    await flushOutbox()
    expect(post).toHaveBeenCalledWith('/messages/vriend', { body: 'Van vóór de update', clientId: 'oud-1' })
    expect(stored()).toHaveLength(0)
  })
})
