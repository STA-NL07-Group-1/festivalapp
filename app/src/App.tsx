import { Fragment, useCallback, useEffect, useState, type ReactNode } from 'react'
import { flushSync } from 'react-dom'
import { useRegisterSW } from 'virtual:pwa-register/react'
import { api, type Announcement, type Friend, type Group, type Message } from './api/client'
import { FestivalBar, NoFestivalScreen } from './components/festival'
import { MessageToast, type IncomingToast } from './components/MessageToast'
import { Toast } from './components/ui'
import { BellIcon, CalendarIcon, MapIcon, MenuIcon, UsersIcon } from './components/icons'
import { useI18n } from './i18n'
import { isMuted } from './lib/mute'
import { flushOutbox, useOutbox } from './lib/outbox'
import { refreshUnread, useUnreadTotal } from './lib/unread'
import { syncPush } from './lib/push'
import { festivalKey } from './lib/offlineStore'
import { useOfflineAsync } from './lib/useAsync'
import { AuthScreen, ResetPasswordScreen } from './screens/AuthScreen'
import { conversationKey, type Conversation } from './lib/conversation'
import { ChatScreen } from './screens/ChatScreen'
import { FriendsScreen } from './screens/FriendsScreen'
import { MapScreen } from './screens/MapScreen'
import { MoreScreen } from './screens/MoreScreen'
import { NewsScreen, announcementText } from './screens/NewsScreen'
import { TimetableScreen } from './screens/TimetableScreen'
import { SessionProvider, useRealtime, useSession } from './state/session'

type Tab = 'kaart' | 'timetable' | 'vrienden' | 'meldingen' | 'meer'
const TABS: Tab[] = ['kaart', 'timetable', 'vrienden', 'meldingen', 'meer']
// Deze tabbladen horen bij één festival. Vrienden en Meer horen bij je account.
const FESTIVAL_TABS: Tab[] = ['kaart', 'timetable', 'meldingen']
const DISMISSED_KEY = 'festivalapp.dismissedEmergencies'
const OUTBOX_RETRY_MS = 15_000

interface DeepLink {
  friendCode: string | null
  chatWith: string | null
  groupId: string | null
  tab: Tab | null
}

/** Deep link uit een adres: ?vriend=CODE (QR), ?tab=…, ?chat=<userId> en ?group=<groupId> (pushmelding) */
function parseLink(search: string): DeepLink {
  const params = new URLSearchParams(search)
  const tab = params.get('tab')
  return {
    friendCode: params.get('vriend'),
    chatWith: params.get('chat'),
    groupId: params.get('group'),
    tab: TABS.includes(tab as Tab) ? (tab as Tab) : null,
  }
}

/** Deep link waarmee de app is geopend; daarna meteen uit de adresbalk */
function readDeepLink(): DeepLink {
  const link = parseLink(window.location.search)
  if (window.location.search) window.history.replaceState(null, '', window.location.pathname)
  return link
}

/**
 * Wisselt van scherm met een View Transition: het oude scherm fadet uit terwijl het nieuwe binnenkomt
 * (zie ::view-transition in index.css). Browsers zonder View Transitions wisselen gewoon direct.
 */
function withTransition(update: () => void) {
  const doc = document as unknown as { startViewTransition?: (callback: () => void) => unknown }
  if (typeof doc.startViewTransition !== 'function') {
    update()
    return
  }
  doc.startViewTransition(() => flushSync(update))
}

/**
 * Links uit een mail: ?reset=… (nieuw wachtwoord) of ?verify=… (e-mailadres bevestigen).
 * Eén keer lezen bij het laden en meteen uit de adresbalk halen, zodat de token niet in de geschiedenis blijft.
 */
function readMailLink(): { kind: 'reset' | 'verify'; token: string } | null {
  const params = new URLSearchParams(window.location.search)
  const reset = params.get('reset')
  const verify = params.get('verify')
  if (!reset && !verify) return null
  params.delete('reset')
  params.delete('verify')
  const rest = params.toString()
  window.history.replaceState(null, '', window.location.pathname + (rest ? `?${rest}` : ''))
  return reset ? { kind: 'reset', token: reset } : { kind: 'verify', token: verify! }
}
const mailLink = readMailLink()

// Eén verzoek per link, ook als React het effect twee keer draait (StrictMode)
let verifying: Promise<boolean> | null = null
const verifyOnce = (token: string) => (verifying ??= api.post('/auth/verify-email', { token }).then(() => true, () => false))

function readDismissed(): string[] {
  try {
    return JSON.parse(localStorage.getItem(DISMISSED_KEY) ?? '[]') as string[]
  } catch {
    return []
  }
}

function UpdatePrompt() {
  const { t } = useI18n()
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW()
  if (!needRefresh) return null
  return (
    <div className="update-banner" role="status">
      {t('common.update')}
      <button type="button" className="button small" onClick={() => void updateServiceWorker(true)}>
        {t('common.reload')}
      </button>
    </div>
  )
}

function Shell() {
  const { t, locale } = useI18n()
  const { online, live, festival, me } = useSession()
  const festivalId = festival?.id ?? null
  const [deepLink] = useState(readDeepLink)
  const [tab, setTab] = useState<Tab>(deepLink.friendCode ? 'vrienden' : (deepLink.tab ?? 'kaart'))
  // Open gesprek (vriend of groep); dan staat de chat over het hele scherm
  const [chatWith, setChatWith] = useState<Conversation | null>(null)
  const [timetableFriend, setTimetableFriend] = useState<string | null>(null)
  const [dismissed, setDismissed] = useState<string[]>(readDismissed)
  const [unread, setUnread] = useState(0)
  // Ongelezen chatberichten (getal op het app-icoon en bij Vrienden)
  const unreadChats = useUnreadTotal()
  const [incoming, setIncoming] = useState<IncomingToast | null>(null)

  // Mededelingen van het gekozen festival; opnieuw ophalen als je van festival wisselt
  // Ook op de telefoon bewaard, zodat je een noodbericht zonder bereik nog kunt teruglezen
  const announcements = useOfflineAsync(festivalKey(festivalId, 'announcements'), () =>
    festivalId ? api.get<Announcement[]>('/announcements') : Promise.resolve([]),
  )
  const setAnnouncements = announcements.setData
  useRealtime<Announcement>(
    'announcement',
    useCallback(
      (a) => {
        setAnnouncements((list) => [a, ...(list ?? []).filter((x) => x.id !== a.id)])
        setUnread((n) => n + 1)
        if (a.level === 'nood') navigator.vibrate?.([300, 100, 300])
      },
      [setAnnouncements],
    ),
  )

  // Wachtrij (chatberichten en pins) alsnog versturen, ook als de chat of de kaart niet open staat:
  // zodra er weer bereik is, de live-verbinding terug is of je de app weer opent. Een iPhone meldt
  // "weer online" niet altijd, daarom ook elke 15 seconden zolang er iets wacht.
  const waiting = useOutbox().length > 0
  useEffect(() => {
    if (online || live) void flushOutbox()
  }, [online, live])
  useEffect(() => {
    if (!waiting) return
    const retry = () => {
      if (document.visibilityState === 'visible') void flushOutbox()
    }
    const timer = setInterval(retry, OUTBOX_RETRY_MS)
    document.addEventListener('visibilitychange', retry)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', retry)
    }
  }, [waiting])

  // Pushmeldingen van dit apparaat aan het ingelogde account koppelen (zie syncPush)
  useEffect(() => {
    void syncPush().catch(() => {})
  }, [])

  // Een gesprek of tabblad openen vanuit een pushmelding: bij het starten van de app (deep link in de URL)
  // of als de app al open was (bericht van de service worker, zie sw.ts). Dan hoeft de app niet opnieuw te laden.
  const openConversation = useCallback((link: DeepLink) => {
    if (link.chatWith) {
      void api.get<Friend[]>('/friends').then((friends) => {
        const friend = friends.find((f) => f.id === link.chatWith)
        if (friend) withTransition(() => setChatWith({ type: 'friend', friend }))
      })
    } else if (link.groupId) {
      void api.get<Group[]>('/groups').then((groups) => {
        const group = groups.find((g) => g.id === link.groupId)
        if (group) withTransition(() => setChatWith({ type: 'group', group }))
      })
    }
  }, [])
  const openLink = useCallback(
    (link: DeepLink) => {
      if (link.chatWith || link.groupId) return openConversation(link)
      if (!link.tab) return
      const next = link.tab
      if (next === 'meldingen') setUnread(0)
      withTransition(() => {
        setChatWith(null)
        setTab(next)
      })
    },
    [openConversation],
  )
  useEffect(() => openConversation(deepLink), [deepLink, openConversation])
  useEffect(() => {
    const sw = navigator.serviceWorker
    if (!sw) return
    const onMessage = (event: MessageEvent) => {
      const data = event.data as { type?: string; url?: string } | null
      if (data?.type !== 'open' || !data.url) return
      openLink(parseLink(new URL(data.url, window.location.origin).search))
    }
    sw.addEventListener('message', onMessage)
    sw.startMessages()
    return () => sw.removeEventListener('message', onMessage)
  }, [openLink])

  // Ongelezen berichten: bij het starten, als je de app weer opent en bij elk nieuw bericht
  useEffect(() => {
    refreshUnread()
    const onVisible = () => document.visibilityState === 'visible' && refreshUnread()
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [])

  // Bericht uit een ander gesprek terwijl de app open is: een melding bovenin (de server stuurt dan geen push).
  // Niet voor je eigen berichten, niet voor het gesprek dat al open staat en niet voor een gedempt gesprek.
  const openId = chatWith ? (chatWith.type === 'friend' ? chatWith.friend.id : chatWith.group.id) : null
  const onIncoming = useCallback(
    (m: Message) => {
      refreshUnread()
      if (m.senderId === me?.id || m.kind === 'systeem') return
      const body = m.kind === 'foto' ? t('chat.newMedia') : (m.body ?? t('chat.newMessage'))
      if (m.groupId) {
        if (m.groupId === openId) return
        void api.get<Group[]>('/groups').then((groups) => {
          const group = groups.find((g) => g.id === m.groupId)
          if (!group || isMuted(group.mutedUntil)) return
          setIncoming({ id: m.id, title: group.name, body, group: true, open: () => openLink(parseLink(`?group=${group.id}`)) })
        })
      } else {
        if (m.senderId === openId) return
        void api.get<Friend[]>('/friends').then((friends) => {
          const friend = friends.find((f) => f.id === m.senderId)
          if (!friend || isMuted(friend.mutedUntil)) return
          setIncoming({ id: m.id, title: friend.displayName, body, group: false, open: () => openLink(parseLink(`?chat=${friend.id}`)) })
        })
      }
    },
    [me?.id, openId, openLink, t],
  )
  useRealtime<Message>('chat.message', onIncoming)
  useRealtime<Message>('group.message', onIncoming)
  const hideIncoming = useCallback(() => setIncoming(null), [])

  const emergency = announcements.data?.find((a) => a.level === 'nood' && !dismissed.includes(a.id))
  const dismiss = (id: string) => {
    const next = [...dismissed, id].slice(-50)
    setDismissed(next)
    try {
      localStorage.setItem(DISMISSED_KEY, JSON.stringify(next))
    } catch {
      /* niets */
    }
  }

  const go = (next: Tab) => {
    if (next === 'meldingen') setUnread(0)
    if (next === tab && !chatWith) return
    withTransition(() => {
      setChatWith(null)
      setTab(next)
    })
  }
  const openChat = (friend: Friend | null) => withTransition(() => setChatWith(friend ? { type: 'friend', friend } : null))
  const openGroup = (group: Group) => withTransition(() => setChatWith({ type: 'group', group }))
  const closeChat = useCallback(() => withTransition(() => setChatWith(null)), [])

  const labels: Record<Tab, string> = {
    kaart: t('tab.map'),
    timetable: t('tab.timetable'),
    vrienden: t('tab.friends'),
    meldingen: t('tab.news'),
    meer: t('tab.more'),
  }
  const icons: Record<Tab, typeof MapIcon> = {
    kaart: MapIcon,
    timetable: CalendarIcon,
    vrienden: UsersIcon,
    meldingen: BellIcon,
    meer: MenuIcon,
  }

  return (
    <div className="shell">
      {!online && (
        <div className="offline-banner" role="status">
          {t('common.offline')}
        </div>
      )}
      {emergency && (
        <div className="emergency-banner" role="alert">
          <strong>⚠️ {announcementText(emergency, locale).title}</strong>
          <p>{announcementText(emergency, locale).body}</p>
          <button type="button" className="button small" onClick={() => dismiss(emergency.id)}>
            {t('news.dismiss')}
          </button>
        </div>
      )}

      <MessageToast key={incoming?.id} toast={incoming} onDone={hideIncoming} />

      {!chatWith && FESTIVAL_TABS.includes(tab) && <FestivalBar />}

      <main className="content">
        {chatWith ? (
          <ChatScreen key={conversationKey(chatWith)} conversation={chatWith} onBack={closeChat} />
        ) : !festival && FESTIVAL_TABS.includes(tab) ? (
          <NoFestivalScreen />
        ) : (
          <>
            {/* key: bij een ander festival beginnen deze schermen opnieuw, zodat er niets van het vorige festival blijft staan */}
            <Fragment key={festivalId ?? 'geen'}>
              {tab === 'kaart' && <MapScreen />}
              {tab === 'timetable' && <TimetableScreen key={timetableFriend ?? 'own'} initialFriend={timetableFriend} />}
            </Fragment>
            {tab === 'vrienden' && (
              <FriendsScreen
                initialCode={deepLink.friendCode}
                onOpenChat={openChat}
                onOpenGroup={openGroup}
                onOpenTimetable={(id) =>
                  withTransition(() => {
                    setTimetableFriend(id)
                    setTab('timetable')
                  })
                }
              />
            )}
            {tab === 'meldingen' && <NewsScreen announcements={announcements.data ?? []} />}
            {tab === 'meer' && <MoreScreen />}
          </>
        )}
      </main>

      <nav className="tabbar" aria-label="Menu">
        {TABS.map((id) => {
          const Icon = icons[id]
          return (
            <button key={id} type="button" aria-current={tab === id && !chatWith ? 'page' : undefined} onClick={() => go(id)}>
              <Icon />
              <span>{labels[id]}</span>
              {id === 'meldingen' && unread > 0 && (
                <span className="tab-badge" aria-label={`${unread}`}>
                  {unread}
                </span>
              )}
              {id === 'vrienden' && unreadChats > 0 && (
                <span className="tab-badge" aria-label={t('friends.unread', { count: unreadChats })}>
                  {unreadChats > 99 ? '99+' : unreadChats}
                </span>
              )}
            </button>
          )
        })}
      </nav>
    </div>
  )
}

/** Bevestigt het e-mailadres uit een ?verify=-link en laat zien of het gelukt is */
function VerifyEmailNotice({ token, children }: { token: string; children: ReactNode }) {
  const { t } = useI18n()
  const { markEmailVerified } = useSession()
  const [message, setMessage] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    void verifyOnce(token).then((ok) => {
      if (cancelled) return
      if (ok) markEmailVerified()
      setMessage(ok ? t('mail.verified') : t('mail.linkInvalid'))
    })
    return () => {
      cancelled = true
    }
  }, [token, markEmailVerified, t])
  return (
    <>
      {children}
      <Toast message={message} onDone={() => setMessage(null)} />
    </>
  )
}

function Gate() {
  const { status } = useSession()
  const { t } = useI18n()
  const [resetToken, setResetToken] = useState(mailLink?.kind === 'reset' ? mailLink.token : null)
  const [notice, setNotice] = useState<string | null>(null)

  if (resetToken) {
    return (
      <ResetPasswordScreen
        token={resetToken}
        onDone={() => {
          setResetToken(null)
          setNotice(t('auth.resetDone'))
        }}
      />
    )
  }
  if (status === 'loading') {
    return (
      <div className="splash" role="status">
        <img src="/logo.png" alt="" width={96} height={96} />
        <span className="visually-hidden">{t('common.loading')}</span>
      </div>
    )
  }
  const screen = status === 'authenticated' ? <Shell /> : <AuthScreen notice={notice} />
  return mailLink?.kind === 'verify' ? <VerifyEmailNotice token={mailLink.token}>{screen}</VerifyEmailNotice> : screen
}

export default function App() {
  return (
    <SessionProvider>
      {/* Service worker al op het inlogscherm aanmelden, zodat de app ook vóór het inloggen offline opent */}
      <UpdatePrompt />
      <Gate />
    </SessionProvider>
  )
}
