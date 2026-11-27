// De koppeling met LibreTranslate, getest tegen een nep-LibreTranslate (een kleine HTTP-server in de test).
// Zo testen we ook wat er gebeurt als de vertaler twijfelt over de taal of uitvalt.
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTranslator } from '../src/translate.ts'

let server: Server
let url = ''
let detected = { language: 'nl', confidence: 90 }
let down = false
const requests: { path: string; body: Record<string, unknown> }[] = []

beforeAll(async () => {
  server = createServer((req, res) => {
    let raw = ''
    req.on('data', (chunk) => (raw += chunk))
    req.on('end', () => {
      const body = JSON.parse(raw) as Record<string, unknown>
      requests.push({ path: req.url ?? '', body })
      if (down) {
        res.writeHead(503).end()
        return
      }
      res.setHeader('Content-Type', 'application/json')
      if (req.url === '/detect') res.end(JSON.stringify([detected]))
      else res.end(JSON.stringify({ translatedText: `${String(body.target)}(${String(body.q)})` }))
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterAll(() => new Promise((resolve) => server.close(resolve)))

describe('vertalen met LibreTranslate', () => {
  it('herkent de taal één keer voor alle velden en vertaalt elk veld naar de andere taal', async () => {
    requests.length = 0
    detected = { language: 'nl', confidence: 90 }
    const result = await createTranslator(url).translate(['Onweer', 'Zoek beschutting.'], 'en')
    expect(result).toEqual({ nl: ['Onweer', 'Zoek beschutting.'], en: ['en(Onweer)', 'en(Zoek beschutting.)'], source: 'nl', failed: false })
    expect(requests.filter((r) => r.path === '/detect')).toHaveLength(1)
    expect(requests.find((r) => r.path === '/translate')?.body).toMatchObject({ source: 'nl', target: 'en', format: 'text' })
  })

  it('twijfelt LibreTranslate of is het geen Nederlands of Engels, dan geldt de taal van het account', async () => {
    detected = { language: 'nl', confidence: 20 }
    expect((await createTranslator(url).translate(['Ok'], 'en')).source).toBe('en')
    detected = { language: 'de', confidence: 95 }
    const result = await createTranslator(url).translate(['Bier hier'], 'nl')
    expect(result).toMatchObject({ source: 'nl', nl: ['Bier hier'], en: ['en(Bier hier)'] })
  })

  it('lege velden gaan niet naar de vertaler', async () => {
    requests.length = 0
    detected = { language: 'en', confidence: 90 }
    const result = await createTranslator(url).translate(['Rules', ''], 'nl')
    expect(result.nl).toEqual(['nl(Rules)', ''])
    expect(requests.filter((r) => r.path === '/translate')).toHaveLength(1)
  })

  it('valt de vertaler uit, dan blijft de originele tekst in beide talen staan', async () => {
    down = true
    const result = await createTranslator(url).translate(['Brand bij podium 2'], 'nl')
    expect(result).toEqual({ nl: ['Brand bij podium 2'], en: ['Brand bij podium 2'], source: 'nl', failed: true })
    down = false
  })

  it('zonder TRANSLATE_URL wordt er niets vertaald', async () => {
    const translator = createTranslator(null)
    expect(translator.enabled).toBe(false)
    expect(await translator.translate(['Hallo'], 'nl')).toMatchObject({ nl: ['Hallo'], en: ['Hallo'], failed: true })
  })
})
