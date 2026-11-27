// Wat er naar de telefoon gaat: de tekst in de taal van de ontvanger (zonder database)
import { describe, expect, it } from 'vitest'
import { pushPayload } from '../src/push.ts'

describe('pushmelding per taal', () => {
  it('kiest de taal van de ontvanger, en een gewone tekst (naam) blijft hetzelfde', () => {
    const message = { title: 'Anna', body: { nl: 'Stuurde je een bericht', en: 'Sent you a message' }, tag: 'chat-1', url: '/?chat=1' }
    expect(JSON.parse(pushPayload(message, 'en'))).toEqual({ title: 'Anna', body: 'Sent you a message', tag: 'chat-1', url: '/?chat=1' })
    expect(JSON.parse(pushPayload(message, 'nl', 4))).toMatchObject({ body: 'Stuurde je een bericht', unread: 4 })
  })
})
