// Melding bovenin de app als er een bericht binnenkomt uit een ander gesprek dan het gesprek dat open staat.
// De app is dan in beeld, dus de server stuurt geen pushmelding (zie realtime.ts): dit is de melding.
// Tik erop om het gesprek te openen. Gaat na een paar seconden vanzelf weg.
// Geef hem key={toast.id}: dan begint hij bij elk nieuw bericht opnieuw.
import { useEffect, useState } from 'react'
import { useI18n } from '../i18n'
import { Avatar } from './ui'
import { GroupIcon } from './icons'

export interface IncomingToast {
  /** Uniek per bericht (gebruik als key) */
  id: string
  title: string
  body: string
  group: boolean
  open: () => void
}

const SHOW_MS = 4000

export function MessageToast({ toast, onDone }: { toast: IncomingToast | null; onDone: () => void }) {
  const { t } = useI18n()
  const [leaving, setLeaving] = useState(false)

  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setLeaving(true), SHOW_MS)
    return () => clearTimeout(timer)
  }, [toast])

  useEffect(() => {
    if (!leaving) return
    const timer = setTimeout(onDone, 180)
    return () => clearTimeout(timer)
  }, [leaving, onDone])

  if (!toast) return null
  return (
    <button
      type="button"
      className={`message-toast ${leaving ? 'closing' : ''}`}
      role="status"
      aria-label={t('chat.openToast', { name: toast.title })}
      onClick={() => {
        toast.open()
        onDone()
      }}
    >
      {toast.group ? (
        <span className="avatar group-avatar" aria-hidden="true">
          <GroupIcon />
        </span>
      ) : (
        <Avatar name={toast.title} size={36} />
      )}
      <span className="grow">
        <strong>{toast.title}</strong>
        <span className="muted small">{toast.body}</span>
      </span>
    </button>
  )
}
