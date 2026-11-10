import { useCallback, useEffect, useState } from 'react'
import { useRegisterSW } from 'virtual:pwa-register/react'
import { api, type Announcement, type Friend } from './api/client'
import { BellIcon, CalendarIcon, MapIcon, MenuIcon, UsersIcon } from './components/icons'
import { useI18n } from './i18n'
import { useAsync } from './lib/useAsync'
import { AuthScreen } from './screens/AuthScreen'
import { ChatScreen } from './screens/ChatScreen'
import { FriendsScreen } from './screens/FriendsScreen'
import { MapScreen } from './screens/MapScreen'
import { MoreScreen } from './screens/MoreScreen'
import { NewsScreen, announcementText } from './screens/NewsScreen'
import { TimetableScreen } from './screens/TimetableScreen'
import { SessionProvider, useRealtime, useSession } from './state/session'

type Tab = 'kaart' | 'timetable' | 'vrienden' | 'meldingen' | 'meer'
const TABS: Tab[] = ['kaart', 'timetable', 'vrienden', 'meldingen', 'meer']
const DISMISSED_KEY = 'festivalapp.dismissedEmergencies'

/** Leest deep links: ?vriend=CODE (QR), ?tab=…, ?chat=<userId> (pushmelding) */
function readDeepLink() {
  const params = new URLSearchParams(window.location.search)
  const tab = params.get('tab')
  const link = {
    friendCode: params.get('vriend'),
    chatWith: params.get('chat'),
    tab: TABS.includes(tab as Tab) ? (tab as Tab) : null,
  }
  if (window.location.search) window.history.replaceState(null, '', window.location.pathname)
  return link
}

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
  const { online } = useSession()
  const [deepLink] = useState(readDeepLink)
  const [tab, setTab] = useState<Tab>(deepLink.friendCode ? 'vrienden' : (deepLink.tab ?? 'kaart'))
  const [chatWith, setChatWith] = useState<Friend | null>(null)
  const [timetableFriend, setTimetableFriend] = useState<string | null>(null)
  const [dismissed, setDismissed] = useState<string[]>(readDismissed)
  const [unread, setUnread] = useState(0)

  const announcements = useAsync(() => api.get<Announcement[]>('/announcements'))
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

  // Chat openen vanuit een pushmelding
  useEffect(() => {
    if (!deepLink.chatWith) return
    void api.get<Friend[]>('/friends').then((friends) => {
      const friend = friends.find((f) => f.id === deepLink.chatWith)
      if (friend) setChatWith(friend)
    })
  }, [deepLink.chatWith])

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
    setChatWith(null)
    setTab(next)
    if (next === 'meldingen') setUnread(0)
  }

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

      <main className="content">
        {chatWith ? (
          <ChatScreen friend={chatWith} onBack={() => setChatWith(null)} />
        ) : (
          <>
            {tab === 'kaart' && <MapScreen />}
            {tab === 'timetable' && <TimetableScreen key={timetableFriend ?? 'own'} initialFriend={timetableFriend} />}
            {tab === 'vrienden' && (
              <FriendsScreen
                initialCode={deepLink.friendCode}
                onOpenChat={setChatWith}
                onOpenTimetable={(id) => {
                  setTimetableFriend(id)
                  setTab('timetable')
                }}
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
            </button>
          )
        })}
      </nav>
    </div>
  )
}

function Gate() {
  const { status } = useSession()
  const { t } = useI18n()
  if (status === 'loading') {
    return (
      <div className="splash" role="status">
        <img src="/logo.png" alt="" width={96} height={96} />
        <span className="visually-hidden">{t('common.loading')}</span>
      </div>
    )
  }
  return status === 'authenticated' ? <Shell /> : <AuthScreen />
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
