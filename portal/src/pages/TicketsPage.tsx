import { useState, type FormEvent } from 'react'
import { api, ApiError } from '../api/client'

/** Codes uit geplakte tekst of een CSV halen (één per regel; eerste kolom). */
// eslint-disable-next-line react-refresh/only-export-components
export function parseTicketCodes(text: string): string[] {
  const codes = text
    .split(/\r?\n/)
    .map((line) => line.split(/[;,\t]/)[0]!.trim().toUpperCase())
    .filter((code) => /^[A-Z0-9-]{8,64}$/.test(code))
  return [...new Set(codes)]
}

export function TicketsPage() {
  const [result, setResult] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [preview, setPreview] = useState(0)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const codes = parseTicketCodes(String(form.get('codes') ?? ''))
    const validFrom = new Date(String(form.get('validFrom'))).toISOString()
    const validUntil = new Date(String(form.get('validUntil'))).toISOString()
    setError(null)
    setResult(null)
    try {
      let imported = 0
      let skipped = 0
      // In blokken van 1000 (de API accepteert maximaal 10.000 per keer)
      for (let i = 0; i < codes.length; i += 1000) {
        const chunk = codes.slice(i, i + 1000).map((code) => ({ code, validFrom, validUntil, ticketType: String(form.get('ticketType')) }))
        const res = await api.post<{ imported: number; skipped: number }>('/admin/tickets/import', { tickets: chunk })
        imported += res.imported
        skipped += res.skipped
      }
      setResult(`${imported} tickets geïmporteerd, ${skipped} overgeslagen (bestonden al of ongeldig).`)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Importeren mislukt.')
    }
  }

  return (
    <section>
      <header className="page-header">
        <h1>Tickets importeren</h1>
        <p className="muted">
          Plak de ticketcodes van de ticketverkoper, één per regel (of een CSV met de code in de eerste kolom). Codes worden
          direct gehasht; de platte codes worden niet opgeslagen.
        </p>
      </header>
      <form className="card form" onSubmit={(e) => void submit(e)}>
        <label>
          Ticketcodes
          <textarea name="codes" rows={10} required onChange={(e) => setPreview(parseTicketCodes(e.target.value).length)} />
          <small className="muted">{preview} geldige codes gevonden</small>
        </label>
        <div className="grid-2">
          <label>
            Geldig vanaf
            <input name="validFrom" type="datetime-local" required />
          </label>
          <label>
            Geldig tot
            <input name="validUntil" type="datetime-local" required />
          </label>
          <label>
            Soort ticket
            <select name="ticketType" defaultValue="weekend">
              <option value="weekend">Weekend</option>
              <option value="dag">Dag</option>
              <option value="vip">VIP</option>
            </select>
          </label>
        </div>
        {error && <p className="error">{error}</p>}
        {result && <p className="success">{result}</p>}
        <button className="button primary" disabled={preview === 0}>
          Importeren
        </button>
      </form>
    </section>
  )
}
