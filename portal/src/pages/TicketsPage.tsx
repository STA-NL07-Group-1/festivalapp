import { useState, type FormEvent } from 'react'
import { api, ApiError, type TicketStats } from '../api/client'
import { useAsync } from '../lib/useAsync'

/** Codes uit geplakte tekst of een CSV halen (één per regel; eerste kolom). */
// eslint-disable-next-line react-refresh/only-export-components
export function parseTicketCodes(text: string): string[] {
  const codes = text
    .split(/\r?\n/)
    .map((line) => line.split(/[;,\t]/)[0]!.trim().toUpperCase())
    .filter((code) => /^[A-Z0-9-]{8,64}$/.test(code))
  return [...new Set(codes)]
}

const number = (n: number) => n.toLocaleString('nl-NL')

/** Hoeveel tickets dit festival heeft, en hoeveel er al aan een account hangen */
function TicketCounts({ stats }: { stats: TicketStats }) {
  const tiles: [string, number][] = [
    ['Totaal', stats.total],
    ['Met account', stats.linked],
    ['Nog te gebruiken', stats.available],
    ['Verlopen of ingetrokken', stats.unusable],
  ]
  return (
    <>
      <div className="ticket-counts">
        {tiles.map(([label, value]) => (
          <div key={label} className="card ticket-count">
            <strong>{number(value)}</strong>
            <span className="muted">{label}</span>
          </div>
        ))}
      </div>
      {stats.byType.length > 0 && (
        <table className="table">
          <thead>
            <tr>
              <th>Soort ticket</th>
              <th>Totaal</th>
              <th>Met account</th>
            </tr>
          </thead>
          <tbody>
            {stats.byType.map((row) => (
              <tr key={row.ticketType}>
                <td>{row.ticketType}</td>
                <td>{number(row.total)}</td>
                <td>{number(row.linked)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  )
}

export function TicketsPage() {
  const stats = useAsync(() => api.get<TicketStats>('/admin/tickets/stats'))
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
      void stats.reload()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Importeren mislukt.')
    }
  }

  return (
    <section>
      <header className="page-header">
        <h1>Tickets</h1>
      </header>
      {stats.data ? <TicketCounts stats={stats.data} /> : stats.error ? <p className="error">Aantallen laden mislukt.</p> : <p className="muted">Laden…</p>}

      <header className="page-header">
        <h2>Tickets importeren</h2>
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
