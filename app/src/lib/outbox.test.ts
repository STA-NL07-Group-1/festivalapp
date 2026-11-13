import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api, ApiError } from '../api/client'
import { deliver, enqueue, flushOutbox, removeFromOutbox } from './outbox'
import { loadOffline } from './offlineStore'

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
