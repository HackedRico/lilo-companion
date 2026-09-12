import { useEffect, useRef, useState, type ReactElement } from 'react'
import { ORB } from '../../shared/layout.ts'
import type { CompanionState, Rect } from '../../shared/types.ts'
import { api } from '../api.ts'
import { trackPointer } from '../drag.ts'
import {
  BLINK_LIDS,
  BLUSH,
  BLUSH_DOTS,
  EXPRESSIONS,
  EYE,
  INK,
  MOUTH,
  moodOf,
  mouthPath,
  type Mood
} from './face.ts'
import { BOX_FILL, BOX_TRANSFORM, GRADIENT_FROM, GRADIENT_TO, MARK, TILE_RADIUS } from './logo.ts'

/**
 * The character: a white tile, the mark, and a face inside the mark's opening.
 * The tile is the fixed point on screen; everything else opens around it and
 * closes back to it. A mood is lids, a gaze and a mouth, and two of them hop.
 */

/** Hops in pixels, from the notes' points at a 66 pt tile, scaled to this one. */
const HOP = { cheering: Math.round(12 * (ORB / 66)), celebrating: Math.round(18 * (ORB / 66)) }

/** One box unit in points, so a stroke can be held to a minimum the eye can see. */
const UNIT_PT = (ORB * BOX_FILL) / 100

export function Orb({ rect, state }: { rect: Rect; state: CompanionState }): ReactElement {
  const tile = useRef<HTMLDivElement>(null)
  const ring = useRef<SVGRectElement>(null)
  const mood = moodOf(state)
  const previous = useRef<Mood>(mood)
  const blinking = useBlink(mood)

  useEffect(() => {
    if (previous.current !== mood) hop(mood, tile.current, ring.current)
    previous.current = mood
  }, [mood])

  const face = EXPRESSIONS[mood]
  const lids = blinking ? BLINK_LIDS : face.lids
  const stroke = Math.max(MOUTH.stroke, MOUTH.minStrokePt / UNIT_PT)

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
      <div className="orb" data-mood={mood}>
        <div className="orb-ring" />
        <div className="orb-body" ref={tile}>
          <svg viewBox="0 0 100 100" role="img" aria-label="Lilo">
            <defs>
              <linearGradient id="orbInk" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" stopColor={GRADIENT_FROM} />
                <stop offset="1" stopColor={GRADIENT_TO} />
              </linearGradient>
            </defs>

            {/* The celebration ring: the tile's own outline, in the gradient, thrown outward. */}
            <rect
              className="orb-burst"
              ref={ring}
              x="0"
              y="0"
              width="100"
              height="100"
              rx={100 * TILE_RADIUS}
              fill="none"
              stroke="url(#orbInk)"
              strokeWidth="3"
              opacity="0"
            />

            <g transform={BOX_TRANSFORM}>
              <path d={MARK} fill="url(#orbInk)" />

              <g className="orb-gaze" style={{ transform: `translate(${face.gaze.dx}px, ${face.gaze.dy}px)` }}>
                {EYE.xs.map((x) => (
                  <g key={x} className="orb-eye" style={{ transform: `scaleY(${lids})` }}>
                    <rect
                      x={x - EYE.width / 2}
                      y={EYE.y - EYE.height / 2}
                      width={EYE.width}
                      height={EYE.height}
                      rx={EYE.width / 2}
                      fill={INK}
                    />
                    <circle
                      cx={x + EYE.highlight.dx}
                      cy={EYE.y + EYE.highlight.dy}
                      r={EYE.highlight.diameter / 2}
                      fill="#ffffff"
                      opacity={EYE.highlight.opacity}
                    />
                  </g>
                ))}
              </g>

              <path
                className="orb-mouth"
                d={mouthPath(face.mouth)}
                fill="none"
                stroke={INK}
                strokeWidth={stroke}
                strokeLinecap="round"
              />

              {BLUSH_DOTS.xs.map((x) => (
                <circle
                  key={x}
                  className="orb-blush"
                  cx={x}
                  cy={BLUSH_DOTS.y}
                  r={BLUSH_DOTS.diameter / 2}
                  fill={BLUSH}
                  opacity={face.blush ? BLUSH_DOTS.opacity : 0}
                />
              ))}
            </g>
          </svg>
        </div>
      </div>
    </div>
  )
}

/** Cheering hops and springs back. Celebrating hops higher and throws the ring. */
function hop(mood: Mood, tile: HTMLDivElement | null, ring: SVGRectElement | null): void {
  if (!tile) return
  if (mood === 'cheering') {
    tile.animate(
      [
        { transform: 'translateY(0)' },
        { transform: `translateY(-${HOP.cheering}px)`, offset: 0.25, easing: 'ease-in' },
        { transform: 'translateY(2px)', offset: 0.65 },
        { transform: 'translateY(0)' }
      ],
      { duration: 480, easing: 'ease-out' }
    )
  }
  if (mood === 'celebrating') {
    tile.animate(
      [
        { transform: 'translateY(0)' },
        { transform: `translateY(-${HOP.celebrating}px)`, offset: 0.25, easing: 'ease-in' },
        { transform: 'translateY(4px)', offset: 0.55 },
        { transform: 'translateY(-1px)', offset: 0.8 },
        { transform: 'translateY(0)' }
      ],
      { duration: 640, easing: 'ease-out' }
    )
    ring?.animate([{ transform: 'scale(1)', opacity: 1 }, { transform: 'scale(1.45)', opacity: 0 }], {
      duration: 900,
      easing: 'cubic-bezier(0.15, 0.7, 0.3, 1)'
    })
  }
}

/** Open eyes blink every 2.5 to 5.5 seconds. A squint and a sleeping face are left alone. */
function useBlink(mood: Mood): boolean {
  const [closed, setClosed] = useState(false)
  useEffect(() => {
    if (mood !== 'idle' && mood !== 'thinking') return
    let alive = true
    let timer: ReturnType<typeof setTimeout>
    const next = (): void => {
      timer = setTimeout(
        () => {
          if (!alive) return
          setClosed(true)
          timer = setTimeout(() => {
            if (!alive) return
            setClosed(false)
            next()
          }, 110)
        },
        2500 + Math.random() * 3000
      )
    }
    next()
    return () => {
      alive = false
      clearTimeout(timer)
      setClosed(false)
    }
  }, [mood])
  return closed
}
