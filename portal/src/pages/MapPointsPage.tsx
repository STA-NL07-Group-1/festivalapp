import { useState, type FormEvent } from 'react'
import { api, ApiError, type MapPoint, type MapPointKind } from '../api/client'
import { useAsync } from '../lib/useAsync'

const KINDS: { value: MapPointKind; label: string }[] = [
  { value: 'wifi', label: '📶 Wifi' },
  { value: 'ehbo', label: '✚ EHBO' },
  { value: 'water', label: '💧 Water' },
  { value: 'toilet', label: 'WC Toilet' },
  { value: 'ingang', label: '⇥ Ingang' },
  { value: 'uitgang', label: '⇤ Uitgang' },
  { value: 'eten', label: '🍴 Eten en drinken' },
  { value: 'activiteit', label: '★ Activiteit' },
  { value: 'oplaadpunt', label: '€ Oplaadpunt bandjes' },
  { value: 'info', label: 'i Informatie' },
]
const kindLabel = (kind: MapPointKind) => KINDS.find((k) => k.value === kind)?.label ?? kind

interface Draft {
  id?: string
  kind: MapPointKind
  name: string
  description: string
  latitude: string
  longitude: string
}

const EMPTY: Draft = { kind: 'wifi', name: '', description: '', latitude: '', longitude: '' }

export function MapPointsPage() {
  const list = useAsync(() => api.get<MapPoint[]>('/map-points'))
  const [draft, setDraft] = useState<Draft>(EMPTY)
  const [error, setError] = useState<string | null>(null)
  const [locating, setLocating] = useState(false)

  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }))

  // Handig op het terrein: ga bij het punt staan en neem je eigen locatie over
  function takeMyLocation() {
    if (!('geolocation' in navigator)) {
      setError('Deze browser kan je locatie niet bepalen.')
      return
    }
    setLocating(true)
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        set({ latitude: pos.coords.latitude.toFixed(6), longitude: pos.coords.longitude.toFixed(6) })
        setLocating(false)
      },
      () => {
        setError('Je locatie kon niet worden bepaald. Geef de browser toestemming of vul de coördinaten zelf in.')
        setLocating(false)
      },
      { enableHighAccuracy: true, timeout: 15_000 },
    )
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    const latitude = Number(draft.latitude.replace(',', '.'))
    const longitude = Number(draft.longitude.replace(',', '.'))
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      setError('Vul een geldige breedte- en lengtegraad in, bijvoorbeeld 52.3868 en 4.8745.')
      return
    }
    const body = { kind: draft.kind, name: draft.name.trim(), latitude, longitude }
    try {
      if (draft.id) {
        const updated = await api.patch<MapPoint>(`/admin/map-points/${draft.id}`, { ...body, description: draft.description.trim() || null })
        list.setData((items) => (items ?? []).map((p) => (p.id === updated.id ? updated : p)))
      } else {
        const created = await api.post<MapPoint>('/admin/map-points', draft.description.trim() ? { ...body, description: draft.description.trim() } : body)
        list.setData((items) => [...(items ?? []), created])
      }
      setDraft(EMPTY)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Opslaan mislukt.')
    }
  }

  async function remove(point: MapPoint) {
    if (!window.confirm(`"${point.name}" van de kaart halen?`)) return
    try {
      await api.delete(`/admin/map-points/${point.id}`)
      list.setData((items) => (items ?? []).filter((p) => p.id !== point.id))
      if (draft.id === point.id) setDraft(EMPTY)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Verwijderen mislukt.')
    }
  }

  const sorted = [...(list.data ?? [])].sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name))

  return (
    <section>
      <header className="page-header">
        <h1>Kaartpunten</h1>
        <p className="muted">
          Punten die bezoekers op de kaart zien, ook zonder internet: wifi, EHBO, water, ingangen, oplaadpunten. Wijzigingen staan direct in de app.
        </p>
      </header>
      <div className="two-columns">
        <form className="card form" onSubmit={(e) => void submit(e)}>
          <h2>{draft.id ? 'Punt wijzigen' : 'Nieuw punt'}</h2>
          <label>
            Soort
            <select value={draft.kind} onChange={(e) => set({ kind: e.target.value as MapPointKind })}>
              {KINDS.map((k) => (
                <option key={k.value} value={k.value}>
                  {k.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Naam
            <input value={draft.name} onChange={(e) => set({ name: e.target.value })} required maxLength={60} placeholder="Wifi bij de ingang" />
          </label>
          <label>
            Uitleg (optioneel)
            <textarea value={draft.description} onChange={(e) => set({ description: e.target.value })} maxLength={200} rows={2} />
          </label>
          <div className="grid-2">
            <label>
              Breedtegraad
              <input value={draft.latitude} onChange={(e) => set({ latitude: e.target.value })} required inputMode="decimal" placeholder="52.3868" />
            </label>
            <label>
              Lengtegraad
              <input value={draft.longitude} onChange={(e) => set({ longitude: e.target.value })} required inputMode="decimal" placeholder="4.8745" />
            </label>
          </div>
          <button type="button" className="button" onClick={takeMyLocation} disabled={locating}>
            {locating ? 'Locatie zoeken…' : '📍 Mijn huidige locatie gebruiken'}
          </button>
          {error && <p className="error">{error}</p>}
          <button className="button primary">{draft.id ? 'Opslaan' : 'Toevoegen'}</button>
          {draft.id && (
            <button type="button" className="link" onClick={() => setDraft(EMPTY)}>
              Annuleren
            </button>
          )}
        </form>

        <div>
          <h2>Op de kaart</h2>
          <ul className="list">
            {sorted.map((p) => (
              <li key={p.id} className="card">
                <strong>{p.name}</strong>
                <p className="muted">
                  {kindLabel(p.kind)} · {p.latitude.toFixed(5)}, {p.longitude.toFixed(5)}
                </p>
                {p.description && <p>{p.description}</p>}
                <div className="status-edit">
                  <button
                    type="button"
                    className="link"
                    onClick={() =>
                      setDraft({
                        id: p.id,
                        kind: p.kind,
                        name: p.name,
                        description: p.description ?? '',
                        latitude: String(p.latitude),
                        longitude: String(p.longitude),
                      })
                    }
                  >
                    Wijzigen
                  </button>
                  <button type="button" className="link danger" onClick={() => void remove(p)}>
                    Verwijderen
                  </button>
                </div>
              </li>
            ))}
          </ul>
          {list.data?.length === 0 && <p className="empty">Nog geen punten. Begin met de wifi-punten en de EHBO-post.</p>}
        </div>
      </div>
    </section>
  )
}
