import { useState, type FormEvent } from 'react'
import { api, ApiError, API_URL, getAccessToken, currentFestival, type FaqItem, type FestivalInfo, type HouseRules as SavedHouseRules } from '../api/client'
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

const TRANSLATION_FAILED = 'Vertalen lukte niet: de tekst staat nu in beide talen hetzelfde. Verbeter de vertaling hieronder.'

function HouseRules({ info }: { info: FestivalInfo }) {
  const [rules, setRules] = useState({ nl: info.houseRulesNl ?? '', en: info.houseRulesEn ?? '' })
  // Eén veld: in het Nederlands of Engels, wordt vertaald. "Vertaling verbeteren": beide talen zelf aanpassen.
  const [text, setText] = useState(rules.nl)
  const [fixing, setFixing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState<string | null>(null)

  async function save(body: Record<string, string>) {
    setError(null)
    setSaved(null)
    try {
      const result = await api.put<SavedHouseRules>('/admin/house-rules', body)
      const next = { nl: result.houseRulesNl ?? '', en: result.houseRulesEn ?? '' }
      setRules(next)
      setText(next.nl)
      setSaved(result.translationFailed && next.nl ? TRANSLATION_FAILED : 'Opgeslagen.')
      setFixing(result.translationFailed && next.nl !== '')
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Opslaan mislukt.')
    }
  }

  return (
    <div className="card form">
      <h2>Huisregels</h2>
      <p className="muted small">
        Eén regel per regel. Schrijf in het Nederlands of het Engels: de huisregels worden automatisch vertaald en bezoekers zien
        ze in de taal van hun app. Leeg laten = geen huisregels tonen.
      </p>
      <form
        className="form"
        onSubmit={(e: FormEvent) => {
          e.preventDefault()
          void save({ houseRules: text })
        }}
      >
        <label>
          Huisregels
          <textarea rows={6} maxLength={5000} value={text} onChange={(e) => setText(e.target.value)} />
        </label>
        <button className="button primary">Opslaan en vertalen</button>
      </form>

      {rules.nl && !fixing && (
        <div className="both-languages">
          <div>
            <span className="lang">NL</span>
            <p>{rules.nl}</p>
          </div>
          <div>
            <span className="lang">EN</span>
            <p>{rules.en}</p>
          </div>
        </div>
      )}
      {rules.nl && !fixing && (
        <button type="button" className="link" onClick={() => setFixing(true)}>
          Vertaling verbeteren
        </button>
      )}
      {fixing && (
        <form
          className="form"
          onSubmit={(e: FormEvent<HTMLFormElement>) => {
            e.preventDefault()
            const form = new FormData(e.currentTarget)
            void save({ houseRulesNl: String(form.get('nl') ?? ''), houseRulesEn: String(form.get('en') ?? '') })
          }}
        >
          <label>
            Nederlands
            <textarea name="nl" rows={6} maxLength={5000} defaultValue={rules.nl} />
          </label>
          <label>
            Engels
            <textarea name="en" rows={6} maxLength={5000} defaultValue={rules.en} />
          </label>
          <div className="status-edit">
            <button className="button primary">Beide talen opslaan</button>
            <button type="button" className="link" onClick={() => setFixing(false)}>
              Annuleren
            </button>
          </div>
        </form>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {saved && (
        <p className={saved === TRANSLATION_FAILED ? 'warning' : 'muted'} role="status">
          {saved}
        </p>
      )}
    </div>
  )
}

/** Nieuwe vraag: één vraag en antwoord (wordt vertaald). Wijzigen: beide talen (om de vertaling te verbeteren). */
interface FaqDraft {
  id?: string
  question: string
  answer: string
  questionNl: string
  questionEn: string
  answerNl: string
  answerEn: string
}
const EMPTY_FAQ: FaqDraft = { question: '', answer: '', questionNl: '', questionEn: '', answerNl: '', answerEn: '' }
/** Een bestaande vraag om te wijzigen (alleen de velden die de API bij wijzigen kent) */
const draftOf = (f: FaqItem): FaqDraft => ({
  ...EMPTY_FAQ,
  id: f.id,
  questionNl: f.questionNl,
  questionEn: f.questionEn,
  answerNl: f.answerNl,
  answerEn: f.answerEn,
})

function Faq({ initial }: { initial: FaqItem[] }) {
  const [items, setItems] = useState(initial)
  const [draft, setDraft] = useState<FaqDraft>(EMPTY_FAQ)
  const [error, setError] = useState<string | null>(null)
  const [warning, setWarning] = useState<string | null>(null)
  const set = (patch: Partial<FaqDraft>) => setDraft((d) => ({ ...d, ...patch }))

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setWarning(null)
    const { id, question, answer, ...languages } = draft
    try {
      if (id) {
        const updated = await api.patch<FaqItem>(`/admin/faq/${id}`, languages)
        setItems((list) => list.map((f) => (f.id === updated.id ? updated : f)))
        setDraft(EMPTY_FAQ)
      } else {
        const created = await api.post<FaqItem>('/admin/faq', { question, answer, sortOrder: items.length })
        setItems((list) => [...list, created])
        // Niet vertaald: meteen de vraag openen om de Engelse (of Nederlandse) tekst zelf in te vullen
        if (created.translationFailed) {
          setWarning(TRANSLATION_FAILED)
          setDraft(draftOf(created))
        } else setDraft(EMPTY_FAQ)
      }
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
      <p className="muted small">
        De festivalassistent in de app gebruikt deze vragen ook. Een nieuwe vraag schrijf je in het Nederlands of het Engels; hij
        wordt automatisch vertaald. Met Wijzigen kun je de vertaling verbeteren.
      </p>
      <ul className="list">
        {items.map((f) => (
          <li key={f.id}>
            <div className="both-languages">
              <div>
                <span className="lang">NL</span>
                <strong>{f.questionNl}</strong>
                <p className="muted small">{f.answerNl}</p>
              </div>
              <div>
                <span className="lang">EN</span>
                <strong>{f.questionEn}</strong>
                <p className="muted small">{f.answerEn}</p>
              </div>
            </div>
            <div className="status-edit">
              <button type="button" className="link" onClick={() => setDraft(draftOf(f))}>
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
        {!draft.id && (
          <>
            <label>
              Vraag
              <input value={draft.question} onChange={(e) => set({ question: e.target.value })} required maxLength={200} />
            </label>
            <label>
              Antwoord
              <textarea value={draft.answer} onChange={(e) => set({ answer: e.target.value })} required maxLength={2000} rows={3} />
            </label>
          </>
        )}
        {draft.id && (
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
        )}
        {warning && (
          <p className="warning" role="status">
            {warning}
          </p>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="status-edit">
          <button className="button primary">{draft.id ? 'Opslaan' : 'Toevoegen'}</button>
          {draft.id && (
            <button
              type="button"
              className="link"
              onClick={() => {
                setDraft(EMPTY_FAQ)
                setWarning(null)
              }}
            >
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
