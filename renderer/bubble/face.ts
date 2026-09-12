import type { OrbState } from '../../shared/types.ts'
import { OPENING } from './logo.ts'

/**
 * The character's face, laid out from the opening in the mark, in the same
 * 100 unit box. Two eyes and a mouth are the whole vocabulary, so every mood
 * has to be said with lids, a gaze and a curve.
 */

export type Mood = 'idle' | 'thinking' | 'cheering' | 'celebrating' | 'asleep'

export const INK = '#171f33'
export const BLUSH = '#ff8094'

const CENTRE_X = OPENING.x + OPENING.width / 2

/** Two capsules either side of the opening's centre, a little above its middle. */
export const EYE = {
  width: 7.5,
  height: 11.5,
  y: OPENING.y + OPENING.height * 0.36,
  xs: [CENTRE_X - 7, CENTRE_X + 7] as const,
  highlight: { diameter: 2.6, dx: -1.4, dy: -3, opacity: 0.95 }
}

/** The frame the mouth is drawn in, and the stroke it is drawn with. */
export const MOUTH = {
  width: 15,
  height: 8,
  cx: CENTRE_X,
  cy: OPENING.y + OPENING.height * 0.7,
  stroke: 2,
  /** In points. At a small tile the stroke is held here rather than scaled away. */
  minStrokePt: 1.4
}

/** Two dots that appear while celebrating, just above the mouth. */
export const BLUSH_DOTS = { diameter: 4, xs: [46, 68] as const, y: MOUTH.cy - 3, opacity: 0.75 }

export type MouthShape = 'smile' | 'grin' | 'o' | 'flat'

export interface Expression {
  mouth: MouthShape
  /** Vertical scale of each eye about its own centre. Open is 1. */
  lids: number
  /** Where both eyes look, in box units. */
  gaze: { dx: number; dy: number }
  blush: boolean
}

export const EXPRESSIONS: Record<Mood, Expression> = {
  idle: { mouth: 'smile', lids: 1, gaze: { dx: 0, dy: 0 }, blush: false },
  thinking: { mouth: 'o', lids: 1, gaze: { dx: 2, dy: -3 }, blush: false },
  cheering: { mouth: 'grin', lids: 0.4, gaze: { dx: 0, dy: 0 }, blush: false },
  celebrating: { mouth: 'grin', lids: 0.4, gaze: { dx: 0, dy: 0 }, blush: true },
  asleep: { mouth: 'flat', lids: 0.45, gaze: { dx: 0, dy: 0 }, blush: false }
}

/** Lids most of the way down, for the length of a blink. */
export const BLINK_LIDS = 0.12

/** Asleep is the panel shut with nothing going on. Everything else is a mood. */
export function moodOf(state: { orb: OrbState; expanded: boolean }): Mood {
  switch (state.orb) {
    case 'alert':
      return 'celebrating'
    case 'cheering':
      return 'cheering'
    case 'thinking':
      return 'thinking'
    case 'idle':
      return state.expanded ? 'idle' : 'asleep'
  }
}

/** The mouth as path data, drawn in its frame. */
export function mouthPath(shape: MouthShape): string {
  const { width: w, height: h, cx, cy } = MOUTH
  const at = (fx: number, fy: number): string => `${cx - w / 2 + fx * w} ${cy - h / 2 + fy * h}`
  switch (shape) {
    case 'smile':
      return `M ${at(0.2, 0.35)} Q ${at(0.5, 1)} ${at(0.8, 0.35)}`
    case 'grin':
      return `M ${at(0, 0.2)} Q ${at(0.5, 1.7)} ${at(1, 0.2)}`
    case 'flat':
      return `M ${at(0.25, 0.5)} L ${at(0.75, 0.5)}`
    case 'o': {
      const rx = w * 0.16
      const ry = h * 0.3
      return `M ${cx - rx} ${cy} A ${rx} ${ry} 0 1 0 ${cx + rx} ${cy} A ${rx} ${ry} 0 1 0 ${cx - rx} ${cy}`
    }
  }
}
