import { useEffect, type ReactElement } from 'react'
import { cornerOf } from '../shared/layout.ts'
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

  return (
    <div className="relative h-full w-full">
      {layout.orb && <Orb rect={layout.orb} state={companion} />}
      {layout.whisper && companion.whisper && (
        <Whisper rect={layout.whisper} line={companion.whisper} />
      )}
      {layout.panel && layout.orb && (
        <Panel rect={layout.panel} corner={cornerOf(layout.panel, layout.orb)} state={companion} />
      )}
    </div>
  )
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
