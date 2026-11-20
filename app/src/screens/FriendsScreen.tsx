import QRCode from 'qrcode'
import { useCallback, useState, type FormEvent } from 'react'
import { api, ApiError, type Friend, type FriendCode, type FriendLocation, type Group } from '../api/client'
import { ChevronIcon, GroupIcon, PlusIcon, UsersIcon } from '../components/icons'
import { SharedMedia } from '../components/SharedMedia'
import { QrScanner } from '../components/QrScanner'
import { Avatar, Empty, Screen, Sheet, Skeleton, Toast } from '../components/ui'
import { useI18n } from '../i18n'
import { formatRelative, formatTime } from '../lib/format'
import { useAsync, useOfflineAsync } from '../lib/useAsync'
import { useRealtime, useSession } from '../state/session'
import { NewGroupSheet } from './GroupScreens'

/** Haal de code uit een gescande QR (URL met ?vriend=…) of getypte tekst. */
// eslint-disable-next-line react-refresh/only-export-components
export function extractFriendCode(text: string): string | null {
  let candidate = text.trim()
  try {
    const url = new URL(candidate)
    candidate = url.searchParams.get('vriend') ?? ''
  } catch {
    /* geen URL: gewoon de tekst */
  }
  const clean = candidate.replace(/[\s-]/g, '').toUpperCase()
  return /^[A-Z0-9]{8}$/.test(clean) ? `${clean.slice(0, 4)}-${clean.slice(4)}` : null
}

export function FriendsScreen({
  initialCode,
  onOpenChat,
  onOpenGroup,
  onOpenTimetable,
}: {
  initialCode: string | null
  onOpenChat: (friend: Friend) => void
  onOpenGroup: (group: Group) => void
  onOpenTimetable: (friendId: string) => void
}) {
  const { t, locale } = useI18n()
  const { me } = useSession()
  // Ook zonder bereik je vriendenlijst zien (om te chatten: berichten gaan dan in de wachtrij)
  const friends = useOfflineAsync('friends', () => api.get<Friend[]>('/friends'))
  const locations = useAsync(() => api.get<FriendLocation[]>('/friends/locations'))
  const groups = useOfflineAsync('groups', () => api.get<Group[]>('/groups'))
  // + knop: kiezen tussen vriend toevoegen en een groep maken
  const [menu, setMenu] = useState(false)
  const [newGroup, setNewGroup] = useState(false)
  const [adding, setAdding] = useState(initialCode !== null)
  const [codeVersion, setCodeVersion] = useState(0)
  const [codeInput, setCodeInput] = useState(initialCode ?? '')
  const [scanning, setScanning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [selected, setSelected] = useState<Friend | null>(null)

  const reloadFriends = friends.reload
  useRealtime('friend.added', useCallback(() => void reloadFriends(), [reloadFriends]))
  useRealtime('friend.removed', useCallback(() => void reloadFriends(), [reloadFriends]))
  // Nieuwe groep, ander lid, nieuw bericht of je bent eruit: de lijst met groepen bijwerken
  const reloadGroups = groups.reload
  const refreshGroups = useCallback(() => void reloadGroups(), [reloadGroups])
  useRealtime('group.updated', refreshGroups)
  useRealtime('group.removed', refreshGroups)
  useRealtime('group.message', refreshGroups)

  // Een nieuwe code zodra het venster opengaat (of bij "Nieuwe code")
  const myCode = useAsync(async () => {
    if (!adding) return null
    const code = await api.post<FriendCode>('/friend-codes')
    const qr = await QRCode.toDataURL(code.qrPayload, { margin: 1, width: 240, color: { dark: '#0f0920', light: '#ffffff' } })
    return { ...code, qr }
  }, [adding, codeVersion]).data

  async function redeem(raw: string) {
    const code = extractFriendCode(raw)
    if (!code) {
      setError(t('friends.invalid'))
      return
    }
    setError(null)
    try {
      const friend = await api.post<Friend>('/friends', { code })
      setToast(t('friends.added', { name: friend.displayName }))
      setAdding(false)
      setCodeInput('')
      void friends.reload()
    } catch (e) {
      setError(e instanceof ApiError && (e.status === 404 || e.status === 400) ? t('friends.invalid') : t('common.error'))
    }
  }

  async function remove(friend: Friend) {
    if (!window.confirm(t('friends.removeConfirm', { name: friend.displayName }))) return
    await api.delete(`/friends/${friend.id}`)
    setSelected(null)
    void friends.reload()
  }

  const locationOf = (id: string) => locations.data?.find((l) => l.userId === id)

  return (
    <Screen
      title={t('friends.title')}
      actions={
        <button type="button" className="icon-button primary" onClick={() => setMenu(true)} aria-label={t('friends.newMenu')}>
          <PlusIcon />
        </button>
      }
    >
      {groups.data && groups.data.length > 0 && (
        <>
          <h2 className="list-title">{t('group.title')}</h2>
          <ul className="list stagger">
            {groups.data.map((g) => (
              <li key={g.id}>
                <button type="button" className="row" onClick={() => onOpenGroup(g)}>
                  <span className="avatar group-avatar" aria-hidden="true">
                    <GroupIcon />
                  </span>
                  <span className="grow">
                    <strong>{g.name}</strong>
                    <span className="muted small">{t('group.members', { count: g.memberCount })}</span>
                  </span>
                  {g.unread > 0 && (
                    <span className="tab-badge inline" aria-label={t('group.unread', { count: g.unread })}>
                      {g.unread}
                    </span>
                  )}
                  <ChevronIcon />
                </button>
              </li>
            ))}
          </ul>
          <h2 className="list-title">{t('friends.title')}</h2>
        </>
      )}
      {friends.loading && <Skeleton rows={3} />}
      {friends.data?.length === 0 && (
        <Empty
          icon={<UsersIcon />}
          action={
            <button type="button" className="button primary small" onClick={() => setAdding(true)}>
              + {t('friends.add')}
            </button>
          }
        >
          {t('friends.empty')}
        </Empty>
      )}
      <ul className="list stagger">
        {friends.data?.map((f) => {
          const loc = locationOf(f.id)
          return (
            <li key={f.id}>
              <button type="button" className={`row ${loc ? 'located' : ''}`} onClick={() => setSelected(f)}>
                <Avatar name={f.displayName} />
                <span className="grow">
                  <strong>{f.displayName}</strong>
                  <span className="muted small">
                    {loc ? t('friends.online', { time: formatRelative(loc.recordedAt, locale) }) : ' '}
                  </span>
                </span>
                <ChevronIcon />
              </button>
            </li>
          )
        })}
      </ul>

      <Sheet open={selected !== null} onClose={() => setSelected(null)} title={selected?.displayName ?? ''}>
        {selected && (
          <div className="stack">
            <p className="muted">{t('friends.since', { date: new Date(selected.since).toLocaleDateString(locale) })}</p>
            <button type="button" className="button primary" onClick={() => onOpenChat(selected)}>
              {t('friends.chat')}
            </button>
            <button type="button" className="button" onClick={() => onOpenTimetable(selected.id)}>
              {t('friends.timetable')}
            </button>
            <SharedMedia target={{ friendId: selected.id }} names={(id) => (id === me?.id ? t('chat.you') : selected.displayName)} />
            <button type="button" className="button danger-outline" onClick={() => void remove(selected)}>
              {t('friends.remove')}
            </button>
          </div>
        )}
      </Sheet>

      <Sheet open={menu} onClose={() => setMenu(false)} title={t('friends.newMenu')}>
        <div className="stack">
          <button
            type="button"
            className="button primary"
            onClick={() => {
              setMenu(false)
              setAdding(true)
            }}
          >
            <UsersIcon /> {t('friends.add')}
          </button>
          <button
            type="button"
            className="button"
            onClick={() => {
              setMenu(false)
              setNewGroup(true)
            }}
          >
            <GroupIcon /> {t('group.new')}
          </button>
        </div>
      </Sheet>

      <NewGroupSheet
        open={newGroup}
        onClose={() => setNewGroup(false)}
        friends={friends.data ?? []}
        onCreated={(group) => {
          setNewGroup(false)
          void groups.reload()
          onOpenGroup({ id: group.id, name: group.name, description: group.description, myRole: group.myRole, memberCount: group.members.length, unread: 0, lastMessageAt: null, createdAt: group.createdAt })
        }}
      />

      <Sheet
        open={adding}
        onClose={() => {
          setAdding(false)
          setScanning(false)
        }}
        title={t('friends.add')}
      >
        <div className="stack">
          <section className="card center">
            <h3>{t('friends.myCode')}</h3>
            {myCode ? (
              <>
                <img src={myCode.qr} alt={myCode.code} width={200} height={200} className="qr" />
                <p className="code">{myCode.code}</p>
                <p className="muted small">{t('friends.codeValid', { time: formatTime(myCode.expiresAt, locale) })}</p>
                <button type="button" className="link" onClick={() => setCodeVersion((v) => v + 1)}>
                  {t('friends.newCode')}
                </button>
              </>
            ) : (
              <Skeleton variant="card" rows={1} />
            )}
          </section>

          <form
            className="form"
            onSubmit={(e: FormEvent) => {
              e.preventDefault()
              void redeem(codeInput)
            }}
          >
            <label>
              {t('friends.enterCode')}
              <input
                value={codeInput}
                onChange={(e) => setCodeInput(e.target.value)}
                placeholder="ABCD-2345"
                maxLength={9}
                autoCapitalize="characters"
                autoComplete="off"
                inputMode="text"
              />
            </label>
            {error && (
              <p className="error-note" role="alert">
                {error}
              </p>
            )}
            <button className="button primary">{t('friends.addButton')}</button>
          </form>

          {scanning ? (
            <QrScanner
              onResult={(text) => {
                setScanning(false)
                void redeem(text)
              }}
              onClose={() => setScanning(false)}
            />
          ) : (
            <button type="button" className="button" onClick={() => setScanning(true)}>
              📷 {t('friends.scan')}
            </button>
          )}
        </div>
      </Sheet>
      <Toast message={toast} onDone={() => setToast(null)} />
    </Screen>
  )
}
