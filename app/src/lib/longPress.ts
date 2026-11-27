// Ingedrukt houden (long press) op een knop, zoals bij WhatsApp op een gesprek.
// Werkt met touch en muis (pointer events), en ook met rechtsklik of het contextmenu van Android.
// Na een long press telt het loslaten niet als gewone tik, anders opent het gesprek ook nog.
import { useRef, type MouseEvent, type PointerEvent } from 'react'

export const LONG_PRESS_MS = 500
/** Zo ver mag je vinger schuiven (scrollen) voordat het geen long press meer is */
const MOVE_TOLERANCE_PX = 10

export function useLongPress(onLongPress: () => void) {
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const start = useRef<{ x: number; y: number } | null>(null)
  const fired = useRef(false)

  const cancel = () => {
    clearTimeout(timer.current)
    start.current = null
  }
  const fire = () => {
    cancel()
    fired.current = true
    // Komt er geen tik meer na (bijv. bij rechtsklik), dan mag de volgende tik weer gewoon werken
    setTimeout(() => (fired.current = false), 1000)
    navigator.vibrate?.(15)
    onLongPress()
  }

  return {
    onPointerDown(event: PointerEvent) {
      if (event.button !== 0) return
      fired.current = false
      start.current = { x: event.clientX, y: event.clientY }
      clearTimeout(timer.current)
      timer.current = setTimeout(fire, LONG_PRESS_MS)
    },
    onPointerMove(event: PointerEvent) {
      if (!start.current) return
      if (Math.hypot(event.clientX - start.current.x, event.clientY - start.current.y) > MOVE_TOLERANCE_PX) cancel()
    },
    onPointerUp: cancel,
    onPointerLeave: cancel,
    onPointerCancel: cancel,
    onContextMenu(event: MouseEvent) {
      event.preventDefault()
      if (!fired.current) fire()
    },
    onClickCapture(event: MouseEvent) {
      if (!fired.current) return
      // Dit was het loslaten na een long press: geen gewone tik
      event.preventDefault()
      event.stopPropagation()
      fired.current = false
    },
  }
}
