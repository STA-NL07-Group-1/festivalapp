// Kleine bouwstenen van het designsysteem.
import { useEffect, useId, useRef, useState, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { useI18n } from '../i18n'
import { initials } from '../lib/format'
import { BackIcon, CloseIcon } from './icons'

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

/** Afstand (px) of snelheid (px/ms) waarbij een veeg omlaag het venster sluit */
const SWIPE_CLOSE_DISTANCE = 110
const SWIPE_CLOSE_SPEED = 0.5

/**
 * Venster omlaag vegen om het te sluiten, zoals bij een app.
 * - Bovenaan (streepje en titel, `.sheet-grab`) werkt vegen altijd. Daar staat touch-action: none in de CSS,
 *   dus de browser begint daar nooit zelf te scrollen. Dat is nodig voor iOS: zodra Safari zelf scrolt,
 *   mogen wij dat niet meer tegenhouden en volgt het venster je vinger niet.
 * - In de rest van het venster alleen als de inhoud bovenaan staat; anders scrol je gewoon door het venster.
 * Touch-events (niet pointer-events), omdat we het scrollen van de browser moeten kunnen tegenhouden.
 */
function useSwipeToClose(ref: RefObject<HTMLDivElement | null>, onClose: () => void, active: boolean) {
  const close = useRef(onClose)
  useEffect(() => {
    close.current = onClose
  })
  useEffect(() => {
    const sheet = ref.current
    if (!active || !sheet) return
    let startX = 0
    let startY = 0
    let startTime = 0
    let distance = 0
    let tracking = false
    let dragging = false
    // Begonnen op het streepje of de titel: dan is elke beweging omlaag vegen, ook als het venster gescrold is
    let fromGrab = false

    const onStart = (e: TouchEvent) => {
      const touch = e.touches[0]
      if (e.touches.length !== 1 || !touch) return
      fromGrab = e.target instanceof Element && e.target.closest('.sheet-grab') !== null && !e.target.closest('button')
      tracking = fromGrab || sheet.scrollTop <= 0
      dragging = false
      distance = 0
      startX = touch.clientX
      startY = touch.clientY
      startTime = performance.now()
    }
    const onMove = (e: TouchEvent) => {
      const touch = e.touches[0]
      if (!tracking || !touch) return
      distance = touch.clientY - startY
      if (fromGrab) e.preventDefault()
      if (!dragging) {
        const sideways = Math.abs(touch.clientX - startX)
        // Pas na 8 px weten we of het een veeg omlaag is; omhoog of opzij = gewoon scrollen of tikken
        if (distance > 8 && distance > sideways) dragging = true
        else if (distance < -8 || sideways > 8) tracking = false
        if (!dragging) return
      }
      e.preventDefault()
      sheet.style.transition = 'none'
      sheet.style.transform = `translateY(${Math.max(0, distance)}px)`
    }
    const onEnd = () => {
      const wasDragging = dragging
      tracking = false
      dragging = false
      if (!wasDragging) return
      const speed = distance / Math.max(1, performance.now() - startTime)
      sheet.style.transition = ''
      if (distance > SWIPE_CLOSE_DISTANCE || (speed > SWIPE_CLOSE_SPEED && distance > 30)) {
        // De sluit-animatie gaat verder vanaf waar de vinger losliet, in plaats van terug te springen
        sheet.style.setProperty('--sheet-shift', `${distance + 120}px`)
        close.current()
      } else {
        sheet.style.transform = ''
      }
    }

    sheet.addEventListener('touchstart', onStart, { passive: true })
    sheet.addEventListener('touchmove', onMove, { passive: false })
    sheet.addEventListener('touchend', onEnd)
    sheet.addEventListener('touchcancel', onEnd)
    return () => {
      sheet.removeEventListener('touchstart', onStart)
      sheet.removeEventListener('touchmove', onMove)
      sheet.removeEventListener('touchend', onEnd)
      sheet.removeEventListener('touchcancel', onEnd)
    }
  }, [ref, active])
}

export function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  const { t } = useI18n()
  const { present, closing } = usePresence(open, 180)
  const sheetRef = useRef<HTMLDivElement>(null)
  useSwipeToClose(sheetRef, onClose, present && !closing)
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
        ref={sheetRef}
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-label={content.title}
        aria-hidden={closing || undefined}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Hier kun je het venster altijd omlaag vegen (zie useSwipeToClose) */}
        <div className="sheet-grab">
          <div className="sheet-handle" aria-hidden="true" />
          <header className="sheet-header">
            <h2>{content.title}</h2>
            <button type="button" className="icon-button sheet-close" onClick={onClose} aria-label={t('common.close')}>
              <CloseIcon />
            </button>
          </header>
        </div>
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
