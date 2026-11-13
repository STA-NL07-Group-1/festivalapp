import { useState, type FormEvent, type ReactNode } from 'react'
import { api, ApiError } from '../api/client'
import { Segmented } from '../components/ui'
import { useI18n } from '../i18n'
import { useSession } from '../state/session'

/** Melding bij een mislukt verzoek op de inlogschermen */
function errorText(e: unknown, t: ReturnType<typeof useI18n>['t']): string {
  if (e instanceof ApiError && e.status === 429) return t('auth.rateLimited')
  if (e instanceof ApiError && e.status === 401) return t('auth.failed')
  if (e instanceof ApiError && e.status === 409) return t('auth.conflict')
  if (e instanceof ApiError && e.status === 400) return e.message
  return t('common.error')
}

/** Het decor van de inlogschermen: lichtbundels, logo en taalkeuze */
function AuthFrame({ children }: { children: ReactNode }) {
  const { t, locale } = useI18n()
  const { setLocale } = useSession()
  return (
    // Het inlogscherm is altijd 'nacht': het eerste wat je ziet is de festivalsfeer
    <main className="auth" data-theme="dark">
      <div className="beams" aria-hidden="true" />
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
      <header className="auth-hero">
        <img src="/logo.png" alt="" width={88} height={88} className="auth-logo" />
        <h1>{t('app.name')}</h1>
        <p>{t('auth.welcome')}</p>
      </header>
      {children}
    </main>
  )
}

export function AuthScreen({ notice }: { notice?: string | null }) {
  const { t } = useI18n()
  const { login, register } = useSession()
  const [mode, setMode] = useState<'login' | 'register' | 'forgot'>('login')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(false)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const value = (name: string) => String(form.get(name) ?? '')
    setBusy(true)
    setError(null)
    try {
      if (mode === 'forgot') {
        await api.post('/auth/forgot-password', { email: value('email') })
        setSent(true)
      } else if (mode === 'login') {
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
      setError(errorText(e, t))
    } finally {
      setBusy(false)
    }
  }

  const switchTo = (next: typeof mode) => {
    setMode(next)
    setError(null)
    setSent(false)
  }

  if (mode === 'forgot') {
    return (
      <AuthFrame>
        <form className="card form" onSubmit={submit}>
          <h2>{t('auth.forgotTitle')}</h2>
          {sent ? (
            <p role="status">{t('auth.forgotSent')}</p>
          ) : (
            <>
              <p className="muted">{t('auth.forgotIntro')}</p>
              <label>
                {t('auth.email')}
                <input name="email" type="email" required maxLength={254} autoComplete="email" />
              </label>
              {error && (
                <p className="error-note" role="alert">
                  {error}
                </p>
              )}
              <button className="button primary" disabled={busy}>
                {busy ? t('common.loading') : t('auth.forgotSend')}
              </button>
            </>
          )}
        </form>
        <button type="button" className="link" onClick={() => switchTo('login')}>
          {t('auth.backToLogin')}
        </button>
      </AuthFrame>
    )
  }

  return (
    <AuthFrame>
      {notice && (
        <p className="card" role="status">
          {notice}
        </p>
      )}
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
        {mode === 'login' && (
          <button type="button" className="link" onClick={() => switchTo('forgot')}>
            {t('auth.forgot')}
          </button>
        )}
        {error && (
          <p className="error-note" role="alert">
            {error}
          </p>
        )}
        <button className="button primary" disabled={busy}>
          {busy ? t('common.loading') : mode === 'login' ? t('auth.login') : t('auth.register')}
        </button>
      </form>

      <button type="button" className="link" onClick={() => switchTo(mode === 'login' ? 'register' : 'login')}>
        {mode === 'login' ? t('auth.toRegister') : t('auth.toLogin')}
      </button>
    </AuthFrame>
  )
}

/** Geopend via de link uit de mail "Nieuw wachtwoord instellen" (?reset=…) */
export function ResetPasswordScreen({ token, onDone }: { token: string; onDone: () => void }) {
  const { t } = useI18n()
  const { status, logout } = useSession()
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const password = String(form.get('password') ?? '')
    if (password !== String(form.get('repeat') ?? '')) {
      setError(t('auth.passwordMismatch'))
      return
    }
    setBusy(true)
    setError(null)
    try {
      await api.post('/auth/reset-password', { token, password })
      // De server heeft alle sessies ingetrokken; ook hier uitloggen en opnieuw inloggen
      if (status === 'authenticated') await logout()
      onDone()
    } catch (e) {
      setError(errorText(e, t))
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthFrame>
      <form className="card form" onSubmit={submit}>
        <h2>{t('auth.resetTitle')}</h2>
        <p className="muted">{t('auth.resetIntro')}</p>
        <label>
          {t('auth.newPassword')}
          <input name="password" type="password" required minLength={12} maxLength={128} autoComplete="new-password" />
          <small>{t('auth.passwordHint')}</small>
        </label>
        <label>
          {t('auth.repeatPassword')}
          <input name="repeat" type="password" required minLength={12} maxLength={128} autoComplete="new-password" />
        </label>
        {error && (
          <p className="error-note" role="alert">
            {error}
          </p>
        )}
        <button className="button primary" disabled={busy}>
          {busy ? t('common.loading') : t('auth.resetSave')}
        </button>
      </form>
    </AuthFrame>
  )
}
