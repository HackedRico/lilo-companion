import type { PointerEvent as ReactPointerEvent } from 'react'
import type { Point } from '../../shared/types.ts'

export interface Track {
  onStart(at: Point): void
  onMove(at: Point): void
  /** Left out by a gesture with nothing to settle once the pointer is gone. */
  onEnd?(): void
  /** Below this many pixels of travel the gesture is a tap, not a drag. */
  threshold?: number
  onTap?(): void
}

let live = false

/**
 * True while a drag is in flight. The window must not turn click-through
 * underneath one, or the pointer stream it is following stops making sense.
 */
export const gesture = {
  get live(): boolean {
    return live
  }
}

/**
 * Screen coordinates, not local ones. The handle moves under the cursor as the
 * window follows it, so a local measurement feeds the gesture back into itself.
 */
export function trackPointer(event: ReactPointerEvent, track: Track): void {
  event.preventDefault()
  const element = event.currentTarget
  const pointerId = event.pointerId
  element.setPointerCapture(pointerId)

  live = true
  const start: Point = { x: event.screenX, y: event.screenY }
  const threshold = track.threshold ?? 0
  let started = threshold === 0
  let latest = start
  let frame = 0

  if (started) track.onStart(start)

  const flush = (): void => {
    frame = 0
    track.onMove(latest)
  }

  const move = (e: PointerEvent): void => {
    if (e.pointerId !== pointerId) return
    latest = { x: e.screenX, y: e.screenY }
    if (!started) {
      if (Math.hypot(latest.x - start.x, latest.y - start.y) < threshold) return
      started = true
      track.onStart(start)
    }
    if (!frame) frame = requestAnimationFrame(flush)
  }

  const finish = (e: PointerEvent, cancelled: boolean): void => {
    if (e.pointerId !== pointerId) return
    live = false
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', end)
    window.removeEventListener('pointercancel', cancel)
    if (frame) cancelAnimationFrame(frame)
    if (element.hasPointerCapture(pointerId)) element.releasePointerCapture(pointerId)
    // A drag that started settles either way, or the main process is left
    // holding an offset and the window never turns click-through again.
    if (started) track.onEnd?.()
    // A cancelled press is not a tap. The system took the pointer away, which
    // is not the student saying yes to whatever the tap does.
    else if (!cancelled) track.onTap?.()
  }

  const end = (e: PointerEvent): void => finish(e, false)
  const cancel = (e: PointerEvent): void => finish(e, true)

  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', end)
  window.addEventListener('pointercancel', cancel)
}
