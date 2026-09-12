/**
 * The mark, drawn in code so it renders identically on every machine and scales
 * with the orb. Everything is in a 100 unit box.
 *
 * Replacing this with the authoritative vector is a one constant swap, as long
 * as GLYPH_BOX still says what the path actually covers.
 */

export const GRADIENT_FROM = '#14a3fa'
export const GRADIENT_TO = '#0d4ff0'

export const ALERT_FROM = '#ffd98a'
export const ALERT_TO = '#d8820b'

/** An L: a chamfered stem, and a foot that runs past it to the right. */
export const MARK = [
  'M 24 26',
  'L 37 13',
  'L 44 13',
  'L 44 74',
  'L 85 74',
  'L 85 87',
  'L 24 87',
  'Z'
].join(' ')

/** What the path covers, so the mark can be centred. */
const GLYPH_BOX = { x: 24, y: 13, width: 61, height: 74 } as const

/** Softens every corner by half its width, the way the printed mark reads. */
export const CORNER_SOFTEN = 2

/** A square glyph in a round plate needs more margin than in a square one. */
const FILL = 0.62

const SCALE = (100 * FILL) / Math.max(GLYPH_BOX.width, GLYPH_BOX.height)

export const GLYPH_TRANSFORM = [
  `translate(${(100 - GLYPH_BOX.width * SCALE) / 2 - GLYPH_BOX.x * SCALE}`,
  `${(100 - GLYPH_BOX.height * SCALE) / 2 - GLYPH_BOX.y * SCALE})`,
  `scale(${SCALE})`
].join(' ')
