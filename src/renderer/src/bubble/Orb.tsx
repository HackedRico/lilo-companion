import { useEffect, useRef, type ReactElement } from 'react'
import type { CompanionState, Rect } from '../../../shared/types.ts'
import { api } from '../api.ts'
import { trackPointer } from '../drag.ts'
import {
  ALERT_FROM,
  ALERT_TO,
  CORNER_SOFTEN,
  GLYPH_TRANSFORM,
  GRADIENT_FROM,
  GRADIENT_TO,
  MARK
} from './logo.ts'

export function Orb({ rect, state }: { rect: Rect; state: CompanionState }): ReactElement {
  const burst = useRef<HTMLDivElement>(null)
  const previous = useRef(state.orb)

  useEffect(() => {
    // The lock-in is the only moment the mark changes colour, so it gets a ring.
    if (previous.current !== 'alert' && state.orb === 'alert') {
      burst.current?.animate([{ scale: '1', opacity: 0.7 }, { scale: '1.7', opacity: 0 }], {
        duration: 900,
        easing: 'cubic-bezier(0.15, 0.7, 0.3, 1)'
      })
    }
    previous.current = state.orb
  }, [state.orb])

  const ink = state.orb === 'alert' ? 'url(#orbAlert)' : 'url(#orbInk)'

  return (
    <div
      className="orb-slot"
      data-solid=""
      style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height }}
      onPointerDown={(event) =>
        trackPointer(event, {
          // Under this much travel it is a tap, which opens the panel.
          threshold: 4,
          onStart: (at) => api.dragStart(at),
          onMove: (at) => api.dragMove(at),
          onEnd: () => api.dragEnd(),
          onTap: () => api.toggle()
        })
      }
    >
      <div className="orb" data-state={state.orb} data-listening={state.listening}>
        <div className="orb-burst" ref={burst} />
        <div className="orb-ring" />
        <div className="orb-body">
          <svg viewBox="0 0 100 100" role="img" aria-label="Lilo">
            <defs>
              <linearGradient id="orbInk" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" stopColor={GRADIENT_FROM} />
                <stop offset="1" stopColor={GRADIENT_TO} />
              </linearGradient>
              <linearGradient id="orbAlert" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" stopColor={ALERT_FROM} />
                <stop offset="1" stopColor={ALERT_TO} />
              </linearGradient>
            </defs>
            <g
              transform={GLYPH_TRANSFORM}
              fill={ink}
              stroke={ink}
              strokeWidth={CORNER_SOFTEN}
              strokeLinejoin="round"
            >
              <path d={MARK} />
            </g>
          </svg>
        </div>
      </div>
    </div>
  )
}
