import { useCallback } from 'react'
import { api, type CrowdLevel, type Stage } from '../api/client'
import { formatTime, useRealtime } from '../lib/realtimeContext'
import { useAsync } from '../lib/useAsync'

const LABEL: Record<CrowdLevel['level'], string> = { rustig: 'Rustig', gemiddeld: 'Gemiddeld', druk: 'Druk', vol: 'Vol' }

export function CrowdPage() {
  const stages = useAsync(() => api.get<Stage[]>('/stages'))
  const crowd = useAsync(() => api.get<CrowdLevel[]>('/crowd'))
  const setCrowd = crowd.setData
  useRealtime<CrowdLevel>(
    'crowd.update',
    useCallback((c) => setCrowd((list) => [...(list ?? []).filter((x) => x.stageId !== c.stageId), c]), [setCrowd]),
  )

  return (
    <section>
      <header className="page-header">
        <h1>Live drukte</h1>
        <p className="muted">Gemeten door de sensoren bij de podia. Metingen ouder dan 15 minuten tellen niet mee.</p>
      </header>
      <div className="cards">
        {stages.data?.map((stage) => {
          const c = crowd.data?.find((x) => x.stageId === stage.id)
          const pct = c?.headCount != null ? Math.min(100, Math.round((c.headCount / stage.capacity) * 100)) : null
          return (
            <article key={stage.id} className={`card crowd ${c?.level ?? 'onbekend'}`}>
              <h2>{stage.name}</h2>
              <p className="big">{c ? LABEL[c.level] : 'Geen meting'}</p>
              {pct !== null && (
                <>
                  <div className="meter" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={`Bezetting ${stage.name}`}>
                    <span style={{ width: `${pct}%` }} />
                  </div>
                  <p className="muted">
                    {c?.headCount} / {stage.capacity} ({pct}%) · {c && formatTime(c.measuredAt)}
                  </p>
                </>
              )}
            </article>
          )
        })}
      </div>
    </section>
  )
}
