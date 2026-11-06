import { useEffect, useState, type FormEvent } from 'react'
import { api } from '../api/client'
import { BackIcon, ChevronIcon } from '../components/icons'
import { ErrorNote, Screen, Segmented, Toast, Toggle } from '../components/ui'
import { useI18n } from '../i18n'
import { disablePush, enablePush, getPushState, type PushState } from '../lib/push'
import { useSession } from '../state/session'

export function MoreScreen() {
  const { t } = useI18n()
  const [view, setView] = useState<'menu' | 'settings' | 'assistant'>('menu')

  if (view === 'settings') return <SettingsScreen onBack={() => setView('menu')} />
  if (view === 'assistant') return <AssistantScreen onBack={() => setView('menu')} />

  return (
    <Screen title={t('more.title')}>
      <ul className="list">
        <li>
          <button type="button" className="row" onClick={() => setView('assistant')}>
            <span className="emoji" aria-hidden="true">
              💬
            </span>
            <span className="grow">{t('more.assistant')}</span>
            <ChevronIcon />
          </button>
        </li>
        <li>
          <button type="button" className="row" onClick={() => setView('settings')}>
            <span className="emoji" aria-hidden="true">
              ⚙️
            </span>
            <span className="grow">{t('more.settings')}</span>
            <ChevronIcon />
          </button>
        </li>
      </ul>
    </Screen>
  )
}

function SubHeader({ title, onBack }: { title: string; onBack: () => void }) {
  const { t } = useI18n()
  return (
    <button type="button" className="back-link" onClick={onBack}>
      <BackIcon /> {t('common.back')}
      <span className="visually-hidden">{title}</span>
    </button>
  )
}

function SettingsScreen({ onBack }: { onBack: () => void }) {
  const { t } = useI18n()
  const { me, updateMe, logout, deleteAccount } = useSession()
  const [push, setPush] = useState<PushState>('off')
  const [toast, setToast] = useState<string | null>(null)
  const [name, setName] = useState(me?.displayName ?? '')

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
      <SubHeader title={t('more.settings')} onBack={onBack} />

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
        <h2>{t('settings.privacy')}</h2>
        <Toggle label={t('settings.shareLocation')} checked={me.shareLocation} onChange={(v) => void save({ shareLocation: v })} />
        <Toggle label={t('settings.shareTimetable')} checked={me.shareTimetable} onChange={(v) => void save({ shareTimetable: v })} />
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
      </section>

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
      <SubHeader title={t('assistant.title')} onBack={onBack} />
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
