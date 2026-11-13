// Kleine bouwstenen van het designsysteem.
import { useEffect, useId, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useI18n } from '../i18n'
import { initials } from '../lib/format'
import { BackIcon } from './icons'

export function Screen({ title, actions, children }: { title: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <section className="screen" aria-labelledby="screen-title">
      <header className="screen-header">
        <h1 id="screen-title">{title}</h1>
        {actions && <div className="screen-actions">{actions}</div>}
      </header>
      <div className="screen-body">{children}</div>
    </section>
  )
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T
  options: { value: T; label: string }[]
  onChange: (value: T) => void
  label: string
}) {
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={value === o.value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function Toggle({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  const id = useId()
  return (
    <div className="toggle-row">
      <label htmlFor={id}>{label}</label>
      <input id={id} type="checkbox" role="switch" className="switch" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
    </div>
  )
}

export function Avatar({ name, size = 40 }: { name: string; size?: number }) {
  // Vaste kleur per naam, binnen het verloop van het logo
  let hash = 0
  for (const c of name) hash = (hash * 31 + c.charCodeAt(0)) | 0
  const hue = 260 + (Math.abs(hash) % 80) - 40
  return (
    <span className="avatar" aria-hidden="true" style={{ width: size, height: size, background: `hsl(${hue} 80% 60%)`, fontSize: size * 0.4 }}>
      {initials(name)}
    </span>
  )
}

/**
 * Houdt iets nog even op het scherm nadat het dicht is gegaan, zodat de exit-animatie
 * kan spelen. `closing` is true tijdens die exit. De tijd hoort bij --dur-sheet-exit of --dur-exit in index.css.
 */
function usePresence(open: boolean, exitMs: number) {
  const [present, setPresent] = useState(open)
  // Tijdens het renderen bijwerken (patroon uit de React-docs), zodat er geen frame zonder venster is
  if (open && !present) setPresent(true)
  useEffect(() => {
    if (open || !present) return
    const timer = setTimeout(() => setPresent(false), exitMs)
    return () => clearTimeout(timer)
  }, [open, present, exitMs])
  return { present: open || present, closing: !open && present }
}

export function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  const { present, closing } = usePresence(open, 180)
  // Inhoud van het laatste open moment bewaren, anders is het venster leeg tijdens de exit
  const [shown, setShown] = useState({ title, children })
  if (open && (shown.title !== title || shown.children !== children)) setShown({ title, children })
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])
  if (!present) return null
  const content = open ? { title, children } : shown
  // Via een portal direct in <body>, zodat het venster altijd boven de kaart en de tabbalk ligt
  return createPortal(
    <div className={`sheet-backdrop ${closing ? 'closing' : ''}`} onClick={onClose}>
      <div
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-label={content.title}
        aria-hidden={closing || undefined}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sheet-handle" aria-hidden="true" />
        <h2>{content.title}</h2>
        {content.children}
      </div>
    </div>,
    document.body,
  )
}

/** Wat een scherm laat zien als er nog niks is: icoon, uitleg en eventueel een knop naar de volgende stap */
export function Empty({ children, icon, action }: { children: ReactNode; icon?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      {icon && (
        <span className="empty-icon" aria-hidden="true">
          {icon}
        </span>
      )}
      <p>{children}</p>
      {action}
    </div>
  )
}

/**
 * Grijze vormen in de vorm van de echte inhoud, zodat het scherm niet springt als de data er is.
 * row = lijst met avatar, text = lijst zonder avatar, set = optreden in de timetable, card = groot vlak, bubble = chatberichten.
 */
export function Skeleton({ rows = 3, variant = 'row' }: { rows?: number; variant?: 'row' | 'text' | 'set' | 'card' | 'bubble' }) {
  const { t } = useI18n()
  const withLead = variant === 'row' || variant === 'set'
  return (
    <div className={`skeleton skeleton-${variant}`} role="status">
      <span className="visually-hidden">{t('common.loading')}</span>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="skeleton-item" aria-hidden="true">
          {withLead && <span className="skeleton-block lead" />}
          <span className="skeleton-lines">
            <span className="skeleton-block" />
            {variant !== 'bubble' && <span className="skeleton-block short" />}
          </span>
        </div>
      ))}
    </div>
  )
}

/** Twee iconen op dezelfde plek; wisselen gaat met een crossfade (zie .icon-swap in index.css) */
export function IconSwap({ on, onIcon, offIcon }: { on: boolean; onIcon: ReactNode; offIcon: ReactNode }) {
  return (
    <span className="icon-swap" data-on={on}>
      {onIcon}
      {offIcon}
    </span>
  )
}

export function ErrorNote({ children }: { children: ReactNode }) {
  return (
    <p className="error-note" role="alert">
      {children}
    </p>
  )
}

export function Toast({ message, onDone }: { message: string | null; onDone: () => void }) {
  const { present, closing } = usePresence(message !== null, 160)
  // Laatste tekst bewaren, zodat de melding tijdens het weggaan niet leeg is
  const [shown, setShown] = useState(message)
  if (message !== null && message !== shown) setShown(message)
  useEffect(() => {
    if (!message) return
    const timer = setTimeout(onDone, 3000)
    return () => clearTimeout(timer)
  }, [message, onDone])
  if (!present) return null
  return (
    <div className={`toast ${closing ? 'closing' : ''}`} role="status">
      {message ?? shown}
    </div>
  )
}

/** Terug-knop bovenaan een subscherm (bijv. in Meer) */
export function BackLink({ title, onBack }: { title: string; onBack: () => void }) {
  const { t } = useI18n()
  return (
    <button type="button" className="back-link" onClick={onBack}>
      <BackIcon /> {t('common.back')}
      <span className="visually-hidden">{title}</span>
    </button>
  )
}
