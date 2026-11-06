import { useCallback, useMemo, useState } from 'react'
import { api, ApiError, type Friend, type Performance, type Signup, type Stage } from '../api/client'
import { StarIcon } from '../components/icons'
import { Empty, ErrorNote, Screen, Segmented, Toast } from '../components/ui'
import { useI18n } from '../i18n'
import { festivalDay, formatDay, formatTime } from '../lib/format'
import { useAsync } from '../lib/useAsync'
import { useRealtime } from '../state/session'

type View = 'all' | 'mine' | 'friends'

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

export function TimetableScreen({ initialFriend }: { initialFriend?: string | null }) {
  const { t, locale } = useI18n()
  const [view, setView] = useState<View>(initialFriend ? 'friends' : 'all')
  const [stageFilter, setStageFilter] = useState<string>('all')
  const [day, setDay] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [friendId, setFriendId] = useState<string | null>(initialFriend ?? null)

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

  const source: Performance[] =
    view === 'all' ? (performances.data ?? []) : view === 'mine' ? (mine.data ?? []) : Array.isArray(friendTimetable.data) ? friendTimetable.data : []
  const filtered = source.filter((p) => stageFilter === 'all' || p.stageId === stageFilter)
  const byDay = groupByDay(filtered)
  const allDays = [...groupByDay(performances.data ?? []).keys()]

  const today = festivalDay(new Date().toISOString())
  const activeDay = day && allDays.includes(day) ? day : allDays.includes(today) ? today : (allDays[0] ?? null)

  async function toggleMine(p: Performance) {
    if (mineIds.has(p.id)) {
      setMine((list) => list?.filter((x) => x.id !== p.id))
      await api.delete(`/me/timetable/${p.id}`).catch(() => mine.reload())
    } else {
      setMine((list) => [...(list ?? []), p])
      await api.put(`/me/timetable/${p.id}`).catch(() => mine.reload())
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

      <div className="chips" role="tablist" aria-label="Dag">
        {allDays.map((d) => (
          <button key={d} type="button" role="tab" aria-selected={activeDay === d} className={`chip ${activeDay === d ? 'active' : ''}`} onClick={() => setDay(d)}>
            {formatDay(d, locale)}
          </button>
        ))}
      </div>
      <div className="chips scroll" aria-label={t('timetable.allStages')}>
        <button type="button" className={`chip ${stageFilter === 'all' ? 'active' : ''}`} onClick={() => setStageFilter('all')}>
          {t('timetable.allStages')}
        </button>
        {stages.data?.map((s) => (
          <button key={s.id} type="button" className={`chip ${stageFilter === s.id ? 'active' : ''}`} onClick={() => setStageFilter(s.id)}>
            {s.name}
          </button>
        ))}
      </div>

      {performances.error ? <ErrorNote>{t('common.error')}</ErrorNote> : null}
      {view === 'mine' && mine.data?.length === 0 && <Empty>{t('timetable.empty')}</Empty>}
      {view === 'friends' && friendId && friendTimetable.data === 'not-shared' && <Empty>{t('timetable.notShared', { name: friendName })}</Empty>}
      {view === 'friends' && friendId && Array.isArray(friendTimetable.data) && friendTimetable.data.length === 0 && (
        <Empty>{t('timetable.friendEmpty', { name: friendName })}</Empty>
      )}

      <ul className="list timetable">
        {items.map((p) => (
          <li key={p.id} className={`performance status-${p.status}`}>
            <div className="time">
              <strong>{formatTime(p.startsAt, locale)}</strong>
              <span>{formatTime(p.endsAt, locale)}</span>
            </div>
            <div className="info">
              <strong className="artist">{p.artist}</strong>
              <span className="muted">{stageName(p.stageId)}</span>
              {p.status !== 'gepland' && <span className={`badge ${p.status}`}>{t(`status.${p.status}`)}</span>}
              {p.description && <span className="muted small">{p.description}</span>}
              {p.signupCapacity ? (
                <span className="signup">
                  <button type="button" className={`button small ${signedUp.has(p.id) ? '' : 'primary'}`} onClick={() => void toggleSignup(p)}>
                    {signedUp.has(p.id) ? t('timetable.signedUp') : t('timetable.signup')}
                  </button>
                  {!signedUp.has(p.id) && <span className="muted small">{t('timetable.limited')}</span>}
                </span>
              ) : null}
            </div>
            <button
              type="button"
              className={`star ${mineIds.has(p.id) ? 'on' : ''}`}
              aria-pressed={mineIds.has(p.id)}
              aria-label={mineIds.has(p.id) ? t('timetable.remove') : t('timetable.add')}
              onClick={() => void toggleMine(p)}
            >
              <StarIcon filled={mineIds.has(p.id)} />
            </button>
          </li>
        ))}
      </ul>
      <Toast message={toast} onDone={() => setToast(null)} />
    </Screen>
  )
}
