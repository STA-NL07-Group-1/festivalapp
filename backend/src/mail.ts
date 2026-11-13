// Mail versturen via Resend (https://resend.com/docs/api-reference/emails/send-email).
// Zonder RESEND_API_KEY (lokaal en in tests) komt de mail alleen in de log, zodat je de link kunt kopiëren.

export interface Mail {
  to: string
  subject: string
  text: string
  html: string
}

export interface Mailer {
  enabled: boolean
  send(mail: Mail): Promise<void>
}

export function createMailer(config: { apiKey: string; from: string } | null, log: (line: string) => void = console.log): Mailer {
  if (!config) {
    return {
      enabled: false,
      send: async (mail) => log(`[mail] aan ${mail.to}: ${mail.subject}\n${mail.text}`),
    }
  }
  return {
    enabled: true,
    async send(mail) {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: config.from, to: [mail.to], subject: mail.subject, text: mail.text, html: mail.html }),
        signal: AbortSignal.timeout(10_000),
      })
      // Alleen de status loggen: de body kan het e-mailadres bevatten
      if (!response.ok) throw new Error(`Resend antwoordde met ${response.status}`)
    },
  }
}

// ------------------------------------------------------------------ teksten

type Locale = 'nl' | 'en'

const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

/** Eenvoudige mail in de stijl van de app: titel, tekst, één knop en een voetregel */
function layout(parts: { title: string; lines: string[]; button?: { label: string; url: string }; footer: string }): { text: string; html: string } {
  const text = [parts.title, '', ...parts.lines, ...(parts.button ? ['', `${parts.button.label}: ${parts.button.url}`] : []), '', parts.footer].join('\n')
  const button = parts.button
    ? `<p style="margin:28px 0"><a href="${escapeHtml(parts.button.url)}" style="background:#8e2bd6;color:#ffffff;padding:14px 24px;border-radius:999px;text-decoration:none;font-weight:700;display:inline-block">${escapeHtml(parts.button.label)}</a></p>`
    : ''
  const html = `<!doctype html><html><body style="margin:0;background:#f6f3fb;font-family:system-ui,-apple-system,'Segoe UI',sans-serif;color:#170f2e">
<div style="max-width:520px;margin:0 auto;padding:32px 20px">
<h1 style="font-size:24px;margin:0 0 16px">${escapeHtml(parts.title)}</h1>
${parts.lines.map((line) => `<p style="font-size:16px;line-height:1.5;margin:0 0 12px">${escapeHtml(line)}</p>`).join('\n')}
${button}
<p style="font-size:13px;color:#645a82;margin-top:32px">${escapeHtml(parts.footer)}</p>
</div></body></html>`
  return { text, html }
}

const footer: Record<Locale, string> = {
  nl: 'Festival Buddy · Je krijgt deze mail omdat dit e-mailadres bij een account hoort.',
  en: 'Festival Buddy · You are receiving this email because this address belongs to an account.',
}

export function welcomeMail(locale: Locale, p: { to: string; name: string; verifyUrl: string }): Mail {
  const nl = locale === 'nl'
  const subject = nl ? 'Welkom bij Festival Buddy' : 'Welcome to Festival Buddy'
  return {
    to: p.to,
    subject,
    ...layout({
      title: nl ? `Welkom, ${p.name}!` : `Welcome, ${p.name}!`,
      lines: nl
        ? ['Je account is klaar. Bevestig nog even je e-mailadres, dan kun je later ook je wachtwoord herstellen.', 'De link is 24 uur geldig.']
        : ['Your account is ready. Please confirm your email address, so you can also reset your password later.', 'The link is valid for 24 hours.'],
      button: { label: nl ? 'Bevestig je e-mailadres' : 'Confirm your email address', url: p.verifyUrl },
      footer: footer[locale],
    }),
  }
}

export function verifyMail(locale: Locale, p: { to: string; verifyUrl: string }): Mail {
  const nl = locale === 'nl'
  return {
    to: p.to,
    subject: nl ? 'Bevestig je e-mailadres' : 'Confirm your email address',
    ...layout({
      title: nl ? 'Bevestig je e-mailadres' : 'Confirm your email address',
      lines: nl ? ['Tik op de knop om je e-mailadres te bevestigen. De link is 24 uur geldig.'] : ['Tap the button to confirm your email address. The link is valid for 24 hours.'],
      button: { label: nl ? 'Bevestigen' : 'Confirm', url: p.verifyUrl },
      footer: footer[locale],
    }),
  }
}

export function resetMail(locale: Locale, p: { to: string; resetUrl: string }): Mail {
  const nl = locale === 'nl'
  return {
    to: p.to,
    subject: nl ? 'Nieuw wachtwoord instellen' : 'Set a new password',
    ...layout({
      title: nl ? 'Nieuw wachtwoord instellen' : 'Set a new password',
      lines: nl
        ? ['Iemand (hopelijk jij) vroeg om een nieuw wachtwoord. De link is 30 minuten geldig en werkt maar één keer.', 'Heb jij dit niet gevraagd? Dan hoef je niets te doen; je wachtwoord blijft hetzelfde.']
        : ['Someone (hopefully you) asked for a new password. The link is valid for 30 minutes and works only once.', "Didn't ask for this? You don't need to do anything; your password stays the same."],
      button: { label: nl ? 'Nieuw wachtwoord kiezen' : 'Choose a new password', url: p.resetUrl },
      footer: footer[locale],
    }),
  }
}

export function passwordChangedMail(locale: Locale, p: { to: string }): Mail {
  const nl = locale === 'nl'
  return {
    to: p.to,
    subject: nl ? 'Je wachtwoord is gewijzigd' : 'Your password has been changed',
    ...layout({
      title: nl ? 'Je wachtwoord is gewijzigd' : 'Your password has been changed',
      lines: nl
        ? ['Het wachtwoord van je Festival Buddy-account is zojuist gewijzigd. Je bent op al je apparaten uitgelogd.', 'Was jij dit niet? Kies dan meteen een nieuw wachtwoord via "Wachtwoord vergeten" en meld het bij de organisatie.']
        : ['The password of your Festival Buddy account was just changed. You have been signed out on all your devices.', 'Wasn\'t you? Choose a new password right away via "Forgot password" and tell the organisers.'],
      footer: footer[locale],
    }),
  }
}
