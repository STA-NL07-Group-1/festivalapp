import QRCode from 'qrcode'
import { useCallback, useState, type FormEvent, type ReactNode } from 'react'
import { api, ApiError, type Friend, type FriendCode, type FriendLocation, type Group } from '../api/client'
import { BellOffIcon, ChevronIcon, GroupIcon, PlusIcon, UsersIcon } from '../components/icons'
import { MuteOptions, MuteSheet } from '../components/MuteSheet'
import { SharedMedia } from '../components/SharedMedia'
import { QrScanner } from '../components/QrScanner'
import { Avatar, Empty, Screen, Sheet, Skeleton, Toast } from '../components/ui'
import { useI18n } from '../i18n'
import { formatRelative, formatTime } from '../lib/format'
import { useLongPress } from '../lib/longPress'
import { isMuted, type MuteTarget } from '../lib/mute'
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

/** Rij in de lijst: tik = openen, ingedrukt houden = dempen (zie lib/longPress.ts) */
function ConversationRow({
  className = '',
  onOpen,
  onLongPress,
  children,
}: {
  className?: string
  onOpen: () => void
  onLongPress: () => void
  children: ReactNode
}) {
  const press = useLongPress(onLongPress)
  return (
    <button type="button" className={`row long-press ${className}`} onClick={onOpen} {...press}>
      {children}
    </button>
  )
}

function UnreadBadge({ count }: { count: number | undefined }) {
  const { t } = useI18n()
  // Bewaarde lijst van een oudere versie heeft nog geen aantal
  if (!count || count <= 0) return null
  return (
    <span className="tab-badge inline" aria-label={t('friends.unread', { count })}>
      {count > 99 ? '99+' : count}
    </span>
  )
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
  // Ingedrukt gehouden gesprek: menu om te dempen
  const [muting, setMuting] = useState<{ target: MuteTarget; name: string; mutedUntil: string | null } | null>(null)

  const reloadFriends = friends.reload
  useRealtime('friend.added', useCallback(() => void reloadFriends(), [reloadFriends]))
  useRealtime('friend.removed', useCallback(() => void reloadFriends(), [reloadFriends]))
  // Nieuwe groep, ander lid, nieuw bericht of je bent eruit: de lijst met groepen bijwerken
  const reloadGroups = groups.reload
  const refreshGroups = useCallback(() => void reloadGroups(), [reloadGroups])
  useRealtime('group.updated', refreshGroups)
  useRealtime('group.removed', refreshGroups)
  useRealtime('group.message', refreshGroups)
  // Nieuw bericht van een vriend (ongelezen) of gedempt op een ander apparaat
  const refreshFriends = useCallback(() => void reloadFriends(), [reloadFriends])
  useRealtime('chat.message', refreshFriends)
  useRealtime(
    'chat.muted',
    useCallback(() => {
      void reloadFriends()
      void reloadGroups()
    }, [reloadFriends, reloadGroups]),
  )

  /** Na dempen: de lijsten meteen bijwerken (zonder te wachten op de server) */
  function applyMute(target: MuteTarget, mutedUntil: string | null) {
    if ('groupId' in target) groups.setData((list) => list?.map((g) => (g.id === target.groupId ? { ...g, mutedUntil } : g)))
    else {
      friends.setData((list) => list?.map((f) => (f.id === target.friendId ? { ...f, mutedUntil } : f)))
      setSelected((f) => (f && f.id === target.friendId ? { ...f, mutedUntil } : f))
    }
  }

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
                <ConversationRow
                  onOpen={() => onOpenGroup(g)}
                  onLongPress={() => setMuting({ target: { groupId: g.id }, name: g.name, mutedUntil: g.mutedUntil })}
                >
                  <span className="avatar group-avatar" aria-hidden="true">
                    <GroupIcon />
                  </span>
                  <span className="grow">
                    <strong>
                      {g.name}
                      {isMuted(g.mutedUntil) && <BellOffIcon className="muted-icon" />}
                    </strong>
                    <span className="muted small">{t('group.members', { count: g.memberCount })}</span>
                  </span>
                  <UnreadBadge count={g.unread} />
                  <ChevronIcon />
                </ConversationRow>
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
              <ConversationRow
                className={loc ? 'located' : ''}
                onOpen={() => setSelected(f)}
                onLongPress={() => setMuting({ target: { friendId: f.id }, name: f.displayName, mutedUntil: f.mutedUntil })}
              >
                <Avatar name={f.displayName} />
                <span className="grow">
                  <strong>
                    {f.displayName}
                    {isMuted(f.mutedUntil) && <BellOffIcon className="muted-icon" />}
                  </strong>
                  <span className="muted small">
                    {loc ? t('friends.online', { time: formatRelative(loc.recordedAt, locale) }) : ' '}
                  </span>
                </span>
                <UnreadBadge count={f.unread} />
                <ChevronIcon />
              </ConversationRow>
            </li>
          )
        })}
      </ul>

      {(friends.data?.length ?? 0) > 0 && <p className="muted small list-hint">{t('mute.longPressHint')}</p>}

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
            <MuteOptions
              target={{ friendId: selected.id }}
              name={selected.displayName}
              mutedUntil={selected.mutedUntil}
              onChanged={(until) => applyMute({ friendId: selected.id }, until)}
            />
            <SharedMedia target={{ friendId: selected.id }} names={(id) => (id === me?.id ? t('chat.you') : selected.displayName)} />
            <button type="button" className="button danger-outline" onClick={() => void remove(selected)}>
              {t('friends.remove')}
            </button>
          </div>
        )}
      </Sheet>

      <MuteSheet
        open={muting !== null}
        onClose={() => setMuting(null)}
        target={muting?.target ?? null}
        name={muting?.name ?? ''}
        mutedUntil={muting?.mutedUntil}
        onChanged={(until) => {
          if (!muting) return
          applyMute(muting.target, until)
          setToast(t(until ? 'mute.done' : 'mute.undone', { name: muting.name }))
        }}
      />

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
          onOpenGroup({ id: group.id, name: group.name, description: group.description, myRole: group.myRole, memberCount: group.members.length, unread: 0, lastMessageAt: null, createdAt: group.createdAt, mutedUntil: null })
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
