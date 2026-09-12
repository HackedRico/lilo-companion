import { useEffect, useState, type ReactElement } from 'react'
import { cornerOf } from '../shared/layout.ts'
import type { Rect } from '../shared/types.ts'
import { api } from './api.ts'
import { gesture } from './drag.ts'
import { Orb } from './bubble/Orb.tsx'
import { Whisper } from './bubble/Whisper.tsx'
import { Panel } from './thread/Panel.tsx'
import { useApp } from './store.ts'

export function App(): ReactElement {
  const companion = useApp((store) => store.companion)
  const layout = useApp((store) => store.layout)
  useKeys()
  useClickThrough()
  const carrying = useLectureDrop()

  return (
    <div className="relative h-full w-full">
      {layout.orb && <Orb rect={layout.orb} state={companion} />}
      {layout.whisper && companion.whisper && (
        <Whisper rect={layout.whisper} line={companion.whisper} />
      )}
      {layout.panel && layout.orb && (
        <Panel rect={layout.panel} corner={cornerOf(layout.panel, layout.orb)} state={companion} />
      )}
      {carrying && (layout.panel ?? layout.orb) && <DropOver rect={(layout.panel ?? layout.orb)!} onOrb={!layout.panel} />}
    </div>
  )
}

/** Where a carried lecture would land. Over the panel when it is open, over the orb when it is not. */
function DropOver({ rect, onOrb }: { rect: Rect; onOrb: boolean }): ReactElement {
  return (
    <div
      className="drop-over"
      data-tight={onOrb ? '' : undefined}
      style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height }}
    >
      {!onOrb && <span>Drop it here</span>}
    </div>
  )
}

/**
 * A lecture dragged onto the companion from anywhere else. The window would
 * otherwise navigate to the file and replace the app with it, which is what a
 * browser does with a dropped file and never what anyone wants here, so every
 * one of these is answered whether or not it is a lecture.
 *
 * Returns whether a file is currently over the window, for the affordance.
 */
function useLectureDrop(): boolean {
  const [carrying, setCarrying] = useState(false)

  useEffect(() => {
    // dragleave fires on every element boundary crossed inside the window, so
    // the count is what says the file has really gone, rather than moved.
    let depth = 0
    const carriesAFile = (event: DragEvent): boolean =>
      Array.from(event.dataTransfer?.types ?? []).includes('Files')

    const onEnter = (event: DragEvent): void => {
      event.preventDefault()
      if (!carriesAFile(event)) return
      depth += 1
      setCarrying(true)
    }
    const onOver = (event: DragEvent): void => {
      event.preventDefault()
      if (event.dataTransfer && carriesAFile(event)) event.dataTransfer.dropEffect = 'copy'
    }
    const onLeave = (event: DragEvent): void => {
      event.preventDefault()
      depth = Math.max(0, depth - 1)
      if (depth === 0) setCarrying(false)
    }
    const onDrop = (event: DragEvent): void => {
      event.preventDefault()
      depth = 0
      setCarrying(false)
      // One lecture at a time. A second would only replace the first.
      const file = event.dataTransfer?.files?.[0]
      if (file) api.dropLecture(file)
    }

    window.addEventListener('dragenter', onEnter)
    window.addEventListener('dragover', onOver)
    window.addEventListener('dragleave', onLeave)
    window.addEventListener('drop', onDrop)
    return () => {
      window.removeEventListener('dragenter', onEnter)
      window.removeEventListener('dragover', onOver)
      window.removeEventListener('dragleave', onLeave)
      window.removeEventListener('drop', onDrop)
    }
  }, [])

  return carrying
}

function useKeys(): void {
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault()
        api.expand(false)
        return
      }
      if (!(event.metaKey || event.ctrlKey)) return
      if (event.key.toLowerCase() === 'w') {
        event.preventDefault()
        api.expand(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}

/**
 * The window is larger than what the companion draws. Anything it is not
 * standing on lets the click through to whatever is underneath.
 */
function useClickThrough(): void {
  useEffect(() => {
    let through: boolean | null = null
    const set = (want: boolean): void => {
      if (want === through) return
      through = want
      api.setClickThrough(want)
    }
    const onMove = (event: MouseEvent): void => {
      // Never mid drag: the orb is being held, whatever is under the pointer.
      if (gesture.live) return
      const element = document.elementFromPoint(event.clientX, event.clientY)
      set(!element?.closest('[data-solid]'))
    }
    const onLeave = (): void => set(true)

    // No starting guess: the window stays solid until a move says otherwise,
    // so the orb is never dead on arrival.
    window.addEventListener('mousemove', onMove)
    document.addEventListener('mouseleave', onLeave)
    return () => {
      window.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseleave', onLeave)
    }
  }, [])
}
