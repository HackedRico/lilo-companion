import { useEffect, useRef, type CSSProperties, type ReactElement } from 'react'
import type { CompanionState, Rect } from '../../shared/types.ts'
import { api } from '../api.ts'
import { trackPointer } from '../drag.ts'
import { FACES, eyeAt } from './face.ts'
import {
  ALERT_FROM,
  ALERT_TO,
  CORNER_SOFTEN,
  GLYPH_TRANSFORM,
  GRADIENT_FROM,
  GRADIENT_TO,
  STEM,
  SWOOSH
} from './logo.ts'

/**
 * The face is drawn over the mark, not instead of it. At rest the orb is the
 * logo. The moment the companion is doing something the mark drops to a tint
 * and the eyes and mouth come up in full ink on top of it, because blue over
 * blue would not read at 56 points.
 */

/** Transitioning a path needs the d in the style, not the attribute. */
function mouthStyle(d: string): CSSProperties {
  return { d: `path("${d}")` } as CSSProperties
}

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
  const face = FACES[state.orb]
  const left = eyeAt(-1, face)
  const right = eyeAt(1, face)
  // Awake whenever it is listening, thinking or alerting, and whenever the
  // panel is open and it is being talked to. Idle with the panel shut is the logo.
  const awake = state.orb !== 'idle' || state.expanded

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
      <div className="orb" data-state={state.orb} data-listening={state.listening} data-face={awake}>
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
              className="orb-mark"
              transform={GLYPH_TRANSFORM}
              fill={ink}
              stroke={ink}
              strokeWidth={CORNER_SOFTEN}
              strokeLinejoin="round"
            >
              <path d={SWOOSH} fillRule="evenodd" />
              <path d={STEM} />
            </g>

            <g className="orb-face" fill={ink}>
              <ellipse className="orb-eye" cx={left.cx} cy={left.cy} rx={face.eye.rx} ry={face.eye.ry} />
              <ellipse className="orb-eye" cx={right.cx} cy={right.cy} rx={face.eye.rx} ry={face.eye.ry} />
              <path
                className="orb-mouth"
                style={mouthStyle(face.open ? `${face.mouth} Z` : face.mouth)}
                fill={face.open ? ink : 'none'}
                stroke={ink}
                strokeWidth={face.open ? 0 : 4.4}
                strokeLinecap="round"
              />
            </g>
          </svg>
        </div>
      </div>
    </div>
  )
}
