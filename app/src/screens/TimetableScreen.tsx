import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react'
import { api, ApiError, type Friend, type Performance, type Signup, type Stage } from '../api/client'
import { StarIcon } from '../components/icons'
import { Empty, ErrorNote, IconSwap, Screen, Segmented, Skeleton, Toast } from '../components/ui'
import { useI18n } from '../i18n'
import { festivalDay, formatDay, formatTime } from '../lib/format'
import { useAsync } from '../lib/useAsync'
import { useRealtime } from '../state/session'

type View = 'all' | 'mine' | 'friends'

/** Elk podium een vaste kleur uit het logo, zodat je een podium in één oogopslag herkent. */
const STAGE_COLORS = ['#ff2fb4', '#a43cf0', '#2a6dff', '#14c8b4', '#ff8a3d', '#e8e3ff']

/** Groepeer optredens per festivaldag (gesorteerd). */
// eslint-disable-next-line react-refresh/only-export-components
export function groupByDay(performances: Performance[]): Map<string, Performance[]> {
  const days = new Map<string, Performance[]>()
  for (const p of [...performances].sort((a, b) => a.startsAt.localeCompare(b.startsAt))) {
    const day = festivalDay(p.startsAt)
    if (!days.has(day)) days.set(day, [])
    days.get(day)!.push(p)
  }
  return days
}

// eslint-disable-next-line react-refresh/only-export-components
export function isLive(p: Performance, now: number): boolean {
  return p.status !== 'geannuleerd' && Date.parse(p.startsAt) <= now && now < Date.parse(p.endsAt)
}

/** Huidige tijd, elke 30 seconden bijgewerkt (voor "nu live"). */
function useNow(): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(timer)
  }, [])
  return now
}

function OnStages({ stages, performances, color }: { stages: Stage[]; performances: Performance[]; color: (id: string) => string }) {
  const { t, locale } = useI18n()
  const now = useNow()
  const today = festivalDay(new Date(now).toISOString())

  return (
    <section className="on-stages" aria-labelledby="on-stages-title">
      <h2 id="on-stages-title">{t('timetable.onStages')}</h2>
      <div className="on-stages-track">
        {stages.map((stage) => {
          const sets = performances.filter((p) => p.stageId === stage.id && p.status !== 'geannuleerd')
          const live = sets.find((p) => isLive(p, now))
          const next = sets.find((p) => Date.parse(p.startsAt) > now && festivalDay(p.startsAt) === today)
          const progress = live
            ? (now - Date.parse(live.startsAt)) / (Date.parse(live.endsAt) - Date.parse(live.startsAt))
            : 0
          return (
            <article key={stage.id} className={`stage-tile ${live ? 'is-live' : ''}`} style={{ '--stage': color(stage.id) } as CSSProperties}>
              <p className="stage-tile-name">{stage.name}</p>
              {live ? (
                <>
                  <p className="stage-tile-status">
                    <span className="live-dot" aria-hidden="true" /> {t('timetable.liveNow')}
                  </p>
                  <p className="stage-tile-artist">{live.artist}</p>
                  <p className="stage-tile-time">{t('timetable.until', { time: formatTime(live.endsAt, locale) })}</p>
                  <div className="stage-tile-progress" role="presentation">
                    <span style={{ width: `${Math.round(progress * 100)}%` }} />
                  </div>
                </>
              ) : next ? (
                <>
                  <p className="stage-tile-status">{t('timetable.startsAt', { time: formatTime(next.startsAt, locale) })}</p>
                  <p className="stage-tile-artist">{next.artist}</p>
                </>
              ) : (
                <p className="stage-tile-status muted">{t('timetable.doneToday')}</p>
              )}
            </article>
          )
        })}
      </div>
    </section>
  )
}

export function TimetableScreen({ initialFriend }: { initialFriend?: string | null }) {
  const { t, locale } = useI18n()
  const now = useNow()
  const [view, setView] = useState<View>(initialFriend ? 'friends' : 'all')
  const [stageFilter, setStageFilter] = useState<string>('all')
  const [day, setDay] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [friendId, setFriendId] = useState<string | null>(initialFriend ?? null)
  // Act die net een ster kreeg: die krijgt een korte puls
  const [popped, setPopped] = useState<string | null>(null)

  const stages = useAsync(() => api.get<Stage[]>('/stages'))
  const performances = useAsync(() => api.get<Performance[]>('/performances'))
  const mine = useAsync(() => api.get<Performance[]>('/me/timetable'))
  const signups = useAsync(() => api.get<Signup[]>('/me/signups'))
  const friends = useAsync(() => api.get<Friend[]>('/friends'))
  const friendTimetable = useAsync(async () => {
    if (!friendId) return null
    try {
      return await api.get<Performance[]>(`/friends/${friendId}/timetable`)
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) return 'not-shared' as const
      throw e
    }
  }, [friendId])

  // Live updates vanuit het beheerportal
  const setPerformances = performances.setData
  const setMine = mine.setData
  useRealtime<Performance>(
    'timetable.update',
    useCallback(
      (updated) => {
        const merge = (list: Performance[] | undefined) =>
          list?.some((p) => p.id === updated.id) ? list.map((p) => (p.id === updated.id ? updated : p)) : list
        setPerformances((list) => (list?.some((p) => p.id === updated.id) ? merge(list) : [...(list ?? []), updated]))
        setMine(merge)
      },
      [setPerformances, setMine],
    ),
  )

  const mineIds = useMemo(() => new Set(mine.data?.map((p) => p.id)), [mine.data])
  const signedUp = useMemo(() => new Set(signups.data?.map((s) => s.performanceId)), [signups.data])
  const stageName = (id: string) => stages.data?.find((s) => s.id === id)?.name ?? ''
  const stageColor = (id: string) => {
    const index = stages.data?.findIndex((s) => s.id === id) ?? -1
    return STAGE_COLORS[Math.max(index, 0) % STAGE_COLORS.length]!
  }

  const source: Performance[] =
    view === 'all' ? (performances.data ?? []) : view === 'mine' ? (mine.data ?? []) : Array.isArray(friendTimetable.data) ? friendTimetable.data : []
  const filtered = source.filter((p) => stageFilter === 'all' || p.stageId === stageFilter)
  const byDay = groupByDay(filtered)
  const allDays = [...groupByDay(performances.data ?? []).keys()]
  const today = festivalDay(new Date(now).toISOString())
  const activeDay = day && allDays.includes(day) ? day : allDays.includes(today) ? today : (allDays[0] ?? null)

  // Optimistic update: de ster gaat meteen aan of uit. Lukt het niet, dan zetten we hem terug en melden we dat.
  async function toggleMine(p: Performance) {
    const failed = () => {
      setToast(t('common.error'))
      void mine.reload()
    }
    if (mineIds.has(p.id)) {
      setMine((list) => list?.filter((x) => x.id !== p.id))
      await api.delete(`/me/timetable/${p.id}`).catch(failed)
    } else {
      setPopped(p.id)
      setMine((list) => [...(list ?? []), p])
      await api.put(`/me/timetable/${p.id}`).catch(failed)
    }
  }

  async function toggleSignup(p: Performance) {
    try {
      if (signedUp.has(p.id)) await api.delete(`/performances/${p.id}/signup`)
      else await api.post(`/performances/${p.id}/signup`)
      await signups.reload()
    } catch (e) {
      setToast(e instanceof ApiError && e.status === 409 ? t('timetable.full') : t('common.error'))
    }
  }

  const friendName = friends.data?.find((f) => f.id === friendId)?.displayName ?? ''
  const items = activeDay ? (byDay.get(activeDay) ?? []) : []

  return (
    <Screen title={t('tab.timetable')}>
      {view === 'all' && stages.data && performances.data && (
        <OnStages stages={stages.data} performances={performances.data} color={stageColor} />
      )}

      <Segmented
        label={t('tab.timetable')}
        value={view}
        onChange={setView}
        options={[
          { value: 'all', label: t('timetable.all') },
          { value: 'mine', label: t('timetable.mine') },
          { value: 'friends', label: t('timetable.friends') },
        ]}
      />

      {view === 'friends' && (
        <label className="select-label">
          {t('timetable.pickFriend')}
          <select value={friendId ?? ''} onChange={(e) => setFriendId(e.target.value || null)}>
            <option value="">—</option>
            {friends.data?.map((f) => (
              <option key={f.id} value={f.id}>
                {f.displayName}
              </option>
            ))}
          </select>
        </label>
      )}

      <div className="days" role="tablist" aria-label={t('tab.timetable')}>
        {allDays.map((d) => {
          const [weekday, date] = formatDay(d, locale).split(/\s(.+)/)
          return (
            <button key={d} type="button" role="tab" aria-selected={activeDay === d} className="day" onClick={() => setDay(d)}>
              <span className="day-name">{weekday}</span>
              <span className="day-date">{date}</span>
            </button>
          )
        })}
      </div>

      <div className="chips scroll" aria-label={t('timetable.allStages')}>
        <button type="button" className={`chip ${stageFilter === 'all' ? 'active' : ''}`} onClick={() => setStageFilter('all')}>
          {t('timetable.allStages')}
        </button>
        {stages.data?.map((s) => (
          <button
            key={s.id}
            type="button"
            className={`chip stage-chip ${stageFilter === s.id ? 'active' : ''}`}
            style={{ '--stage': stageColor(s.id) } as CSSProperties}
            onClick={() => setStageFilter(s.id)}
          >
            <span className="stage-swatch" aria-hidden="true" />
            {s.name}
          </button>
        ))}
      </div>

      {performances.error ? <ErrorNote>{t('common.error')}</ErrorNote> : null}
      {view === 'all' && performances.loading && <Skeleton variant="set" rows={4} />}
      {view === 'mine' && mine.loading && <Skeleton variant="set" rows={2} />}
      {view === 'mine' && mine.data?.length === 0 && (
        <Empty
          icon={<StarIcon />}
          action={
            <button type="button" className="button small" onClick={() => setView('all')}>
              {t('timetable.browseAll')}
            </button>
          }
        >
          {t('timetable.empty')}
        </Empty>
      )}
      {view === 'friends' && friendId && friendTimetable.data === 'not-shared' && <Empty>{t('timetable.notShared', { name: friendName })}</Empty>}
      {view === 'friends' && friendId && Array.isArray(friendTimetable.data) && friendTimetable.data.length === 0 && (
        <Empty>{t('timetable.friendEmpty', { name: friendName })}</Empty>
      )}

      <ol className="lineup stagger">
        {items.map((p) => {
          const live = isLive(p, now)
          return (
            <li
              key={p.id}
              className={`set status-${p.status} ${live ? 'is-live' : ''}`}
              style={{ '--stage': stageColor(p.stageId) } as CSSProperties}
            >
              <time className="set-time" dateTime={p.startsAt}>
                {formatTime(p.startsAt, locale)}
                <span>{formatTime(p.endsAt, locale)}</span>
              </time>
              <div className="set-main">
                <h3 className="set-artist">{p.artist}</h3>
                <p className="set-meta">
                  <span className="set-stage">{stageName(p.stageId)}</span>
                  {live && (
                    <span className="live-label">
                      <span className="live-dot" aria-hidden="true" />
                      {t('timetable.liveNow')}
                    </span>
                  )}
                  {p.status !== 'gepland' && <span className={`badge ${p.status}`}>{t(`status.${p.status}`)}</span>}
                </p>
                {p.description && <p className="set-description">{p.description}</p>}
                {p.signupCapacity ? (
                  <p className="signup">
                    <button
                      type="button"
                      className={`button small ${signedUp.has(p.id) ? 'outline' : 'primary'}`}
                      onClick={() => void toggleSignup(p)}
                    >
                      {signedUp.has(p.id) ? t('timetable.signedUp') : t('timetable.signup')}
                    </button>
                    {!signedUp.has(p.id) && <span className="muted small">{t('timetable.limited')}</span>}
                  </p>
                ) : null}
              </div>
              <button
                type="button"
                className={`star ${mineIds.has(p.id) ? 'on' : ''} ${popped === p.id ? 'pop' : ''}`}
                aria-pressed={mineIds.has(p.id)}
                aria-label={t(mineIds.has(p.id) ? 'timetable.remove' : 'timetable.add', { artist: p.artist })}
                onClick={() => void toggleMine(p)}
              >
                <IconSwap on={mineIds.has(p.id)} onIcon={<StarIcon filled />} offIcon={<StarIcon />} />
              </button>
            </li>
          )
        })}
      </ol>
      <Toast message={toast} onDone={() => setToast(null)} />
    </Screen>
  )
}
