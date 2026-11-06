import { useState, type FormEvent } from 'react'
import { ApiError } from '../api/client'
import { Segmented } from '../components/ui'
import { useI18n } from '../i18n'
import { useSession } from '../state/session'

export function AuthScreen() {
  const { t, locale } = useI18n()
  const { login, register, setLocale } = useSession()
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const value = (name: string) => String(form.get(name) ?? '')
    setBusy(true)
    setError(null)
    try {
      if (mode === 'login') {
        await login(value('email'), value('password'))
      } else {
        await register({
          ticketCode: value('ticketCode').trim().toUpperCase(),
          email: value('email'),
          password: value('password'),
          displayName: value('displayName'),
        })
      }
    } catch (e) {
      if (e instanceof ApiError && e.status === 429) setError(t('auth.rateLimited'))
      else if (e instanceof ApiError && e.status === 401) setError(t('auth.failed'))
      else if (e instanceof ApiError && e.status === 409) setError(t('auth.conflict'))
      else if (e instanceof ApiError && e.status === 400) setError(e.message)
      else setError(t('common.error'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="auth">
      <div className="auth-lang">
        <Segmented
          label="Taal / Language"
          value={locale}
          onChange={setLocale}
          options={[
            { value: 'nl', label: 'NL' },
            { value: 'en', label: 'EN' },
          ]}
        />
      </div>
      <img src="/logo.png" alt="" width={96} height={96} className="auth-logo" />
      <h1>{t('app.name')}</h1>
      <p className="muted">{t('auth.welcome')}</p>

      <form className="card form" onSubmit={submit}>
        <h2>{mode === 'login' ? t('auth.login') : t('auth.register')}</h2>
        {mode === 'register' && (
          <>
            <label>
              {t('auth.ticket')}
              <input name="ticketCode" required minLength={8} maxLength={64} pattern="[A-Za-z0-9\-]+" autoCapitalize="characters" autoComplete="off" />
              <small>{t('auth.ticketHint')}</small>
            </label>
            <label>
              {t('auth.name')}
              <input name="displayName" required maxLength={40} autoComplete="nickname" />
            </label>
          </>
        )}
        <label>
          {t('auth.email')}
          <input name="email" type="email" required maxLength={254} autoComplete="email" />
        </label>
        <label>
          {t('auth.password')}
          <input
            name="password"
            type="password"
            required
            minLength={mode === 'register' ? 12 : 1}
            maxLength={128}
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
          />
          {mode === 'register' && <small>{t('auth.passwordHint')}</small>}
        </label>
        {error && (
          <p className="error-note" role="alert">
            {error}
          </p>
        )}
        <button className="button primary" disabled={busy}>
          {busy ? t('common.loading') : mode === 'login' ? t('auth.login') : t('auth.register')}
        </button>
      </form>

      <button
        type="button"
        className="link"
        onClick={() => {
          setMode(mode === 'login' ? 'register' : 'login')
          setError(null)
        }}
      >
        {mode === 'login' ? t('auth.toRegister') : t('auth.toLogin')}
      </button>
    </main>
  )
}
