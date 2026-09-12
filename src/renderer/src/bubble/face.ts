import type { OrbState } from '../../../shared/types.ts'

/**
 * The companion's face, in the same 100 unit box as the mark. Two eyes and a
 * mouth are the whole vocabulary, so every state has to be said with a radius
 * and a curve.
 *
 * Every mouth is one quadratic with the same command structure, and the eyes
 * differ only in their geometry properties. Chromium animates both, so the face
 * moves between states rather than cutting.
 */
export interface Expression {
  /** Half width and half height of an eye. Taller reads as more awake. */
  eye: { rx: number; ry: number }
  /** How far the eyes sit from centre, and how high. */
  gaze: { dx: number; dy: number }
  mouth: string
  /** A mouth that is open is filled; a mouth that is a line is stroked. */
  open: boolean
}

const EYE_Y = 43
const EYE_X = 13

export const FACES: Record<OrbState, Expression> = {
  // Awake and unbothered: round eyes, a shallow smile.
  idle: {
    eye: { rx: 7, ry: 7 },
    gaze: { dx: 0, dy: 0 },
    mouth: 'M 38 62 Q 50 71 62 62',
    open: false
  },
  // Taking something in. Eyes a little taller, mouth almost closed.
  listening: {
    eye: { rx: 7, ry: 8.5 },
    gaze: { dx: 0, dy: -1 },
    mouth: 'M 40 65 Q 50 67 60 65',
    open: false
  },
  // Looking away and up, the way anyone does while working something out.
  thinking: {
    eye: { rx: 6.5, ry: 5.5 },
    gaze: { dx: 3, dy: -3 },
    mouth: 'M 42 66 Q 50 63 58 66',
    open: false
  },
  // The lock-in. Eyes wide, mouth open, and the ink turns gold around it.
  alert: {
    eye: { rx: 8.5, ry: 9.5 },
    gaze: { dx: 0, dy: -1 },
    mouth: 'M 41 61 Q 50 77 59 61',
    open: true
  }
}

export function eyeAt(side: -1 | 1, face: Expression): { cx: number; cy: number } {
  return { cx: 50 + side * EYE_X + face.gaze.dx, cy: EYE_Y + face.gaze.dy }
}
