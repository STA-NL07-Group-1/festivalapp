import { useState, type FormEvent } from 'react'
import { api, ApiError, API_URL, getAccessToken, currentFestival, type FaqItem, type FestivalInfo } from '../api/client'
import { formatDateTime } from '../lib/realtimeContext'
import { useAsync } from '../lib/useAsync'

const MAX_IMAGE_BYTES = 3 * 1024 * 1024

/** Bestand → base64 zonder het "data:...;base64,"-voorvoegsel */
function toBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '')
    reader.onerror = () => reject(reader.error ?? new Error('lezen mislukt'))
    reader.readAsDataURL(file)
  })
}

function HouseRules({ info }: { info: FestivalInfo }) {
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    setError(null)
    setSaved(false)
    try {
      await api.put('/admin/house-rules', { houseRulesNl: String(form.get('nl') ?? ''), houseRulesEn: String(form.get('en') ?? '') })
      setSaved(true)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Opslaan mislukt.')
    }
  }

  return (
    <form className="card form" onSubmit={(e) => void submit(e)}>
      <h2>Huisregels</h2>
      <p className="muted small">Eén regel per regel. Bezoekers zien de tekst in hun eigen taal. Leeg laten = geen huisregels tonen.</p>
      <label>
        Nederlands
        <textarea name="nl" rows={6} maxLength={5000} defaultValue={info.houseRulesNl ?? ''} />
      </label>
      <label>
        Engels
        <textarea name="en" rows={6} maxLength={5000} defaultValue={info.houseRulesEn ?? ''} />
      </label>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {saved && (
        <p className="muted" role="status">
          Opgeslagen.
        </p>
      )}
      <button className="button primary">Huisregels opslaan</button>
    </form>
  )
}

interface FaqDraft {
  id?: string
  questionNl: string
  questionEn: string
  answerNl: string
  answerEn: string
}
const EMPTY_FAQ: FaqDraft = { questionNl: '', questionEn: '', answerNl: '', answerEn: '' }

function Faq({ initial }: { initial: FaqItem[] }) {
  const [items, setItems] = useState(initial)
  const [draft, setDraft] = useState<FaqDraft>(EMPTY_FAQ)
  const [error, setError] = useState<string | null>(null)
  const set = (patch: Partial<FaqDraft>) => setDraft((d) => ({ ...d, ...patch }))

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    const { id, ...body } = draft
    try {
      if (id) {
        const updated = await api.patch<FaqItem>(`/admin/faq/${id}`, body)
        setItems((list) => list.map((f) => (f.id === updated.id ? updated : f)))
      } else {
        const created = await api.post<FaqItem>('/admin/faq', { ...body, sortOrder: items.length })
        setItems((list) => [...list, created])
      }
      setDraft(EMPTY_FAQ)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Opslaan mislukt.')
    }
  }

  async function remove(item: FaqItem) {
    if (!window.confirm(`"${item.questionNl}" verwijderen?`)) return
    setError(null)
    try {
      await api.delete(`/admin/faq/${item.id}`)
      setItems((list) => list.filter((f) => f.id !== item.id))
      if (draft.id === item.id) setDraft(EMPTY_FAQ)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Verwijderen mislukt.')
    }
  }

  return (
    <div className="card form">
      <h2>Veelgestelde vragen</h2>
      <p className="muted small">De festivalassistent in de app gebruikt deze vragen ook.</p>
      <ul className="list">
        {items.map((f) => (
          <li key={f.id}>
            <strong>{f.questionNl}</strong>
            <p className="muted small">{f.answerNl}</p>
            <div className="status-edit">
              <button type="button" className="link" onClick={() => setDraft({ ...f })}>
                Wijzigen
              </button>
              <button type="button" className="link danger" onClick={() => void remove(f)}>
                Verwijderen
              </button>
            </div>
          </li>
        ))}
      </ul>
      {items.length === 0 && <p className="empty">Nog geen vragen.</p>}

      <form className="form" onSubmit={(e) => void submit(e)}>
        <h3>{draft.id ? 'Vraag wijzigen' : 'Nieuwe vraag'}</h3>
        <div className="grid-2">
          <label>
            Vraag (Nederlands)
            <input value={draft.questionNl} onChange={(e) => set({ questionNl: e.target.value })} required maxLength={200} />
          </label>
          <label>
            Vraag (Engels)
            <input value={draft.questionEn} onChange={(e) => set({ questionEn: e.target.value })} required maxLength={200} />
          </label>
          <label>
            Antwoord (Nederlands)
            <textarea value={draft.answerNl} onChange={(e) => set({ answerNl: e.target.value })} required maxLength={2000} rows={3} />
          </label>
          <label>
            Antwoord (Engels)
            <textarea value={draft.answerEn} onChange={(e) => set({ answerEn: e.target.value })} required maxLength={2000} rows={3} />
          </label>
        </div>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="status-edit">
          <button className="button primary">{draft.id ? 'Opslaan' : 'Toevoegen'}</button>
          {draft.id && (
            <button type="button" className="link" onClick={() => setDraft(EMPTY_FAQ)}>
              Annuleren
            </button>
          )}
        </div>
      </form>
    </div>
  )
}

function SiteMap({ initialUpdatedAt }: { initialUpdatedAt: string | null }) {
  const [updatedAt, setUpdatedAt] = useState(initialUpdatedAt)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // Voorbeeld: de afbeelding vraagt een token, dus ophalen met fetch en tonen als blob
  const preview = useAsync(async () => {
    if (!updatedAt) return null
    const token = await getAccessToken()
    const festival = currentFestival()
    const res = await fetch(`${API_URL}/site-map`, {
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(festival ? { 'X-Festival-Id': festival } : {}) },
    })
    return res.ok ? URL.createObjectURL(await res.blob()) : null
  }, [updatedAt])

  async function upload(file: File | undefined) {
    if (!file) return
    setError(null)
    if (file.size > MAX_IMAGE_BYTES) {
      setError('De afbeelding mag maximaal 3 MB zijn. Maak hem kleiner en probeer het opnieuw.')
      return
    }
    setBusy(true)
    try {
      const result = await api.put<{ siteMapUpdatedAt: string }>('/admin/site-map', { image: await toBase64(file) })
      setUpdatedAt(result.siteMapUpdatedAt)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Uploaden mislukt.')
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    if (!window.confirm('Plattegrond weghalen? Bezoekers zien hem dan niet meer.')) return
    setError(null)
    try {
      await api.delete('/admin/site-map')
      setUpdatedAt(null)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Verwijderen mislukt.')
    }
  }

  return (
    <div className="card form">
      <h2>Plattegrond</h2>
      <p className="muted small">
        De plattegrond die het festival zelf maakt (png, jpeg of webp, maximaal 3 MB). Bezoekers zien hem in de app onder Meer, ook zonder internet als ze hem al eens
        hebben geopend.
      </p>
      {updatedAt ? (
        <>
          {preview.data && <img className="site-map-preview" src={preview.data} alt="Huidige plattegrond" />}
          <p className="muted small">Geüpload: {formatDateTime(updatedAt)}</p>
        </>
      ) : (
        <p className="empty">Nog geen plattegrond.</p>
      )}
      <label>
        {updatedAt ? 'Nieuwe plattegrond kiezen' : 'Plattegrond kiezen'}
        <input type="file" accept="image/png,image/jpeg,image/webp" disabled={busy} onChange={(e) => void upload(e.target.files?.[0])} />
      </label>
      {busy && (
        <p className="muted" role="status">
          Uploaden…
        </p>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {updatedAt && (
        <button type="button" className="link danger" onClick={() => void remove()}>
          Plattegrond weghalen
        </button>
      )}
    </div>
  )
}

export function InfoPage() {
  const info = useAsync(() => api.get<FestivalInfo>('/festival-info'))
  return (
    <section>
      <header className="page-header">
        <h1>Festivalinfo</h1>
        <p className="muted">Huisregels, veelgestelde vragen en de plattegrond van dit festival. Bezoekers vinden dit in de app onder Meer.</p>
      </header>
      {info.loading && <p className="muted">Laden…</p>}
      {info.data && (
        <div className="two-columns">
          <div className="form">
            <Faq initial={info.data.faq} />
          </div>
          <div className="form">
            <HouseRules info={info.data} />
            <SiteMap initialUpdatedAt={info.data.siteMapUpdatedAt} />
          </div>
        </div>
      )}
    </section>
  )
}
