import { useEffect, useState, type FormEvent } from 'react'
import { api, ApiError } from '../api/client'
import { ChevronIcon } from '../components/icons'
import { AddTicketForm, FestivalList } from '../components/festival'
import { BackLink, ErrorNote, Screen, Segmented, Toast, Toggle } from '../components/ui'
import { useI18n } from '../i18n'
import { disablePush, enablePush, getPushState, type PushState } from '../lib/push'
import { useSession } from '../state/session'
import { FestivalInfoScreen, type FestivalInfoView } from './FestivalInfoScreens'
import { LegalScreen } from './LegalScreen'

type View = 'menu' | 'festivals' | 'account' | 'settings' | 'assistant' | 'codeOfConduct' | 'privacyPolicy' | FestivalInfoView

/** Eén regel in het menu van Meer */
function MenuRow({ emoji, label, detail, onClick }: { emoji: string; label: string; detail?: string; onClick: () => void }) {
  return (
    <li>
      <button type="button" className="row" onClick={onClick}>
        <span className="emoji" aria-hidden="true">
          {emoji}
        </span>
        <span className="grow">
          {label}
          {detail && <span className="muted small">{detail}</span>}
        </span>
        <ChevronIcon />
      </button>
    </li>
  )
}

export function MoreScreen() {
  const { t } = useI18n()
  const { me, festival } = useSession()
  const [view, setView] = useState<View>('menu')
  const back = () => setView('menu')

  if (view === 'festivals') return <MyFestivalsScreen onBack={back} />
  if (view === 'account') return <AccountScreen onBack={back} />
  if (view === 'settings') return <SettingsScreen onBack={back} />
  if (view === 'assistant') return <AssistantScreen onBack={back} />
  if (view === 'codeOfConduct') return <LegalScreen which="codeOfConduct" onBack={back} />
  if (view === 'privacyPolicy') return <LegalScreen which="privacyPolicy" onBack={back} />
  if (view !== 'menu') return <FestivalInfoScreen view={view} onBack={back} />

  // Personeel en eigenaren krijgen een snelkoppeling naar het beheerportal
  const staff = (me?.role ?? 'bezoeker') !== 'bezoeker' || Boolean(me?.platformRole)

  return (
    <Screen title={t('more.title')}>
      {/* Wat bij het gekozen festival hoort. Alleen als je bij een festival hoort. */}
      {festival && (
        <>
          <h2 className="list-title">{festival.name}</h2>
          <ul className="list">
            <MenuRow emoji="🗺️" label={t('info.siteMap')} onClick={() => setView('plattegrond')} />
            <MenuRow emoji="❓" label={t('info.faq')} onClick={() => setView('faq')} />
            <MenuRow emoji="📜" label={t('info.houseRules')} onClick={() => setView('huisregels')} />
            <MenuRow emoji="🧳" label={t('info.lostItems')} onClick={() => setView('gevonden')} />
            <MenuRow emoji="💬" label={t('more.assistant')} onClick={() => setView('assistant')} />
          </ul>
        </>
      )}

      <h2 className="list-title">{t('more.you')}</h2>
      <ul className="list">
        <MenuRow
          emoji="🎟️"
          label={t('more.festivals')}
          detail={festival ? festival.name : t('festival.none.short')}
          onClick={() => setView('festivals')}
        />
        <MenuRow emoji="👤" label={t('more.account')} detail={me?.displayName} onClick={() => setView('account')} />
        <MenuRow emoji="⚙️" label={t('more.settings')} onClick={() => setView('settings')} />
        {staff && (
          <li>
            <a className="row" href="/beheer/">
              <span className="emoji" aria-hidden="true">
                🛠️
              </span>
              <span className="grow">{t('more.portal')}</span>
              <ChevronIcon />
            </a>
          </li>
        )}
      </ul>

      <h2 className="list-title">{t('more.about')}</h2>
      <ul className="list">
        <MenuRow emoji="🤝" label={t('legal.codeOfConduct')} onClick={() => setView('codeOfConduct')} />
        <MenuRow emoji="🔒" label={t('legal.privacyPolicy')} onClick={() => setView('privacyPolicy')} />
      </ul>
    </Screen>
  )
}

function MyFestivalsScreen({ onBack }: { onBack: () => void }) {
  const { t } = useI18n()
  const [toast, setToast] = useState<string | null>(null)
  return (
    <Screen title={t('more.festivals')}>
      <BackLink title={t('more.festivals')} onBack={onBack} />
      <p className="muted">{t('festivals.intro')}</p>
      <FestivalList onChosen={() => setToast(t('festivals.chosen'))} />
      <AddTicketForm onAdded={(added) => setToast(added ? t('festivals.added', { name: added.name }) : t('festivals.addedOther'))} />
      <Toast message={toast} onDone={() => setToast(null)} />
    </Screen>
  )
}

/** Account: wat bij jou als persoon hoort en op de server staat */
function AccountScreen({ onBack }: { onBack: () => void }) {
  const { t } = useI18n()
  const { me, updateMe, logout, deleteAccount, resendVerifyEmail } = useSession()
  const [toast, setToast] = useState<string | null>(null)
  const [name, setName] = useState(me?.displayName ?? '')
  const [sending, setSending] = useState(false)

  if (!me) return null

  const resend = async () => {
    setSending(true)
    try {
      await resendVerifyEmail()
      setToast(t('account.verifySent'))
    } catch (e) {
      setToast(e instanceof ApiError && e.status === 429 ? t('auth.rateLimited') : t('common.error'))
    } finally {
      setSending(false)
    }
  }

  const save = async (patch: Parameters<typeof updateMe>[0]) => {
    await updateMe(patch)
    setToast(t('settings.saved'))
  }

  return (
    <Screen title={t('more.account')}>
      <BackLink title={t('more.account')} onBack={onBack} />

      {/* === false: een oud profiel uit de offline opslag heeft dit veld nog niet */}
      {me.emailVerified === false && (
        <section className="card verify-email" role="status">
          <h2>{t('account.verifyTitle')}</h2>
          <p>{t('account.verifyText', { email: me.email })}</p>
          <button type="button" className="button small" disabled={sending} onClick={() => void resend()}>
            {sending ? t('common.loading') : t('account.verifyResend')}
          </button>
        </section>
      )}

      <section className="card">
        <h2>{t('settings.profile')}</h2>
        <form
          className="inline-form"
          onSubmit={(e: FormEvent) => {
            e.preventDefault()
            if (name.trim()) void save({ displayName: name.trim() })
          }}
        >
          <label className="grow">
            {t('settings.name')}
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} required />
          </label>
          <button className="button small">{t('common.save')}</button>
        </form>
        <p className="muted small">{me.email}</p>
      </section>

      <section className="card">
        <h2>{t('settings.privacy')}</h2>
        <Toggle label={t('settings.shareLocation')} checked={me.shareLocation} onChange={(v) => void save({ shareLocation: v })} />
        <Toggle label={t('settings.shareTimetable')} checked={me.shareTimetable} onChange={(v) => void save({ shareTimetable: v })} />
      </section>

      <ChangePasswordForm onChanged={() => setToast(t('account.passwordChanged'))} />

      <section className="card">
        <h2>{t('settings.account')}</h2>
        <div className="stack">
          <button type="button" className="button" onClick={() => void logout()}>
            {t('settings.logout')}
          </button>
          <button
            type="button"
            className="button danger-outline"
            onClick={() => {
              if (window.confirm(t('settings.deleteConfirm'))) void disablePush().finally(() => void deleteAccount())
            }}
          >
            {t('settings.delete')}
          </button>
        </div>
      </section>
      <Toast message={toast} onDone={() => setToast(null)} />
    </Screen>
  )
}

/** Wachtwoord wijzigen terwijl je ingelogd bent */
function ChangePasswordForm({ onChanged }: { onChanged: () => void }) {
  const { t } = useI18n()
  const { changePassword } = useSession()
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const formElement = event.currentTarget
    const form = new FormData(formElement)
    const value = (name: string) => String(form.get(name) ?? '')
    if (value('newPassword') !== value('repeat')) {
      setError(t('auth.passwordMismatch'))
      return
    }
    setBusy(true)
    setError(null)
    try {
      await changePassword(value('currentPassword'), value('newPassword'))
      formElement.reset()
      onChanged()
    } catch (e) {
      if (e instanceof ApiError && e.status === 429) setError(t('auth.rateLimited'))
      else if (e instanceof ApiError && e.status === 400) setError(e.message)
      else setError(t('common.error'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="card">
      <h2>{t('account.password')}</h2>
      <form className="form" onSubmit={submit}>
        <label>
          {t('account.currentPassword')}
          <input name="currentPassword" type="password" required maxLength={128} autoComplete="current-password" />
        </label>
        <label>
          {t('auth.newPassword')}
          <input name="newPassword" type="password" required minLength={12} maxLength={128} autoComplete="new-password" />
          <small>{t('auth.passwordHint')}</small>
        </label>
        <label>
          {t('auth.repeatPassword')}
          <input name="repeat" type="password" required minLength={12} maxLength={128} autoComplete="new-password" />
        </label>
        {error && <ErrorNote>{error}</ErrorNote>}
        <button className="button" disabled={busy}>
          {busy ? t('common.loading') : t('account.password')}
        </button>
      </form>
    </section>
  )
}

/** Instellingen van de app: weergave, taal en meldingen op dit apparaat */
function SettingsScreen({ onBack }: { onBack: () => void }) {
  const { t } = useI18n()
  const { me, updateMe } = useSession()
  const [push, setPush] = useState<PushState>('off')
  const [toast, setToast] = useState<string | null>(null)

  useEffect(() => {
    void getPushState().then(setPush)
  }, [])

  if (!me) return null

  const save = async (patch: Parameters<typeof updateMe>[0]) => {
    await updateMe(patch)
    setToast(t('settings.saved'))
  }

  const pushMessage: Partial<Record<PushState, string>> = {
    unsupported: t('settings.pushUnsupported'),
    denied: t('settings.pushDenied'),
    'server-off': t('settings.pushServerOff'),
  }

  return (
    <Screen title={t('more.settings')}>
      <BackLink title={t('more.settings')} onBack={onBack} />

      <section className="card">
        <h2>{t('settings.appearance')}</h2>
        <p className="label">{t('settings.theme')}</p>
        <Segmented
          label={t('settings.theme')}
          value={me.theme}
          onChange={(theme) => void save({ theme })}
          options={[
            { value: 'systeem', label: t('settings.theme.systeem') },
            { value: 'licht', label: t('settings.theme.licht') },
            { value: 'donker', label: t('settings.theme.donker') },
          ]}
        />
        <p className="label">{t('settings.language')}</p>
        <Segmented
          label={t('settings.language')}
          value={me.locale}
          onChange={(locale) => void save({ locale })}
          options={[
            { value: 'nl', label: 'Nederlands' },
            { value: 'en', label: 'English' },
          ]}
        />
      </section>

      <section className="card">
        <h2>{t('settings.notifications')}</h2>
        <Toggle
          label={t('settings.push')}
          checked={push === 'on'}
          disabled={push === 'unsupported' || push === 'denied'}
          onChange={(v) => void (v ? enablePush() : disablePush()).then(setPush).catch(() => setToast(t('common.error')))}
        />
        {pushMessage[push] && <p className="muted small">{pushMessage[push]}</p>}
        <p className="label">{t('settings.notifyAbout')}</p>
        {/* !== false: een oud profiel uit de offline opslag heeft deze velden nog niet (dan staan ze aan) */}
        <Toggle label={t('settings.notifyChat')} checked={me.notifyChat !== false} onChange={(v) => void save({ notifyChat: v })} />
        <Toggle label={t('settings.notifyTimetable')} checked={me.notifyTimetable !== false} onChange={(v) => void save({ notifyTimetable: v })} />
        <Toggle
          label={t('settings.notifyAnnouncements')}
          checked={me.notifyAnnouncements !== false}
          onChange={(v) => void save({ notifyAnnouncements: v })}
        />
        <p className="muted small">{t('settings.notifyEmergency')}</p>
      </section>
      <Toast message={toast} onDone={() => setToast(null)} />
    </Screen>
  )
}

interface QA {
  question: string
  answer: string | null
}

function AssistantScreen({ onBack }: { onBack: () => void }) {
  const { t, locale } = useI18n()
  const [history, setHistory] = useState<QA[]>([])
  const [question, setQuestion] = useState('')
  const [error, setError] = useState(false)

  async function ask(event: FormEvent) {
    event.preventDefault()
    const q = question.trim()
    if (!q) return
    setQuestion('')
    setError(false)
    setHistory((h) => [...h, { question: q, answer: null }])
    try {
      const { answer } = await api.post<{ answer: string }>('/chatbot', { question: q, locale })
      setHistory((h) => h.map((item, i) => (i === h.length - 1 ? { ...item, answer } : item)))
    } catch {
      setHistory((h) => h.slice(0, -1))
      setQuestion(q)
      setError(true)
    }
  }

  return (
    <Screen title={t('assistant.title')}>
      <BackLink title={t('assistant.title')} onBack={onBack} />
      <p className="muted">{t('assistant.intro')}</p>
      <div className="chat-messages assistant" aria-live="polite">
        {history.map((item, i) => (
          <div key={i}>
            <div className="bubble mine">
              <p>{item.question}</p>
            </div>
            <div className="bubble theirs">
              <p>{item.answer ?? '…'}</p>
            </div>
          </div>
        ))}
      </div>
      {error && <ErrorNote>{t('common.error')}</ErrorNote>}
      <form className="chat-input" onSubmit={(e) => void ask(e)}>
        <input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder={t('assistant.placeholder')}
          maxLength={500}
          aria-label={t('assistant.placeholder')}
        />
        <button className="button primary small">{t('assistant.ask')}</button>
      </form>
      <p className="muted small">{t('assistant.privacy')}</p>
    </Screen>
  )
}
