import QRCode from 'qrcode'
import { useCallback, useState, type FormEvent } from 'react'
import { api, ApiError, type Friend, type FriendCode, type FriendLocation } from '../api/client'
import { ChevronIcon } from '../components/icons'
import { QrScanner } from '../components/QrScanner'
import { Avatar, Empty, Screen, Sheet, Toast } from '../components/ui'
import { useI18n } from '../i18n'
import { formatRelative, formatTime } from '../lib/format'
import { useAsync } from '../lib/useAsync'
import { useRealtime } from '../state/session'

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
  onOpenTimetable,
}: {
  initialCode: string | null
  onOpenChat: (friend: Friend) => void
  onOpenTimetable: (friendId: string) => void
}) {
  const { t, locale } = useI18n()
  const friends = useAsync(() => api.get<Friend[]>('/friends'))
  const locations = useAsync(() => api.get<FriendLocation[]>('/friends/locations'))
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
        <button type="button" className="button primary small" onClick={() => setAdding(true)}>
          + {t('friends.add')}
        </button>
      }
    >
      {friends.data?.length === 0 && <Empty>{t('friends.empty')}</Empty>}
      <ul className="list">
        {friends.data?.map((f) => {
          const loc = locationOf(f.id)
          return (
            <li key={f.id}>
              <button type="button" className="row" onClick={() => setSelected(f)}>
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
            <button type="button" className="button danger-outline" onClick={() => void remove(selected)}>
              {t('friends.remove')}
            </button>
          </div>
        )}
      </Sheet>

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
              <p>{t('common.loading')}</p>
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
