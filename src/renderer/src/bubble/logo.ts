/**
 * The mark, drawn in code so it renders identically on every machine and scales
 * with the orb. Everything is in a 100 unit box.
 *
 * Replacing this with the authoritative vector is a two constant swap, as long
 * as GLYPH_BOX still says what the paths actually cover.
 */

export const GRADIENT_FROM = '#14a3fa'
export const GRADIENT_TO = '#0d4ff0'

export const ALERT_FROM = '#ffd98a'
export const ALERT_TO = '#d8820b'

/** A chamfered top bar, the bowl, and a tail cut away at the bottom right. */
export const SWOOSH = [
  'M 24 26',
  'L 37 13',
  'L 58 13',
  'C 76 13 87 27 87 45',
  'L 87 55',
  'C 87 72 77 84 61 88',
  'L 55 75',
  'C 66 72 74 64 74 53',
  'L 74 47',
  'C 74 35 65 26 52 26',
  'Z'
].join(' ')

/** The stem and its foot, set apart from the ring by the opening. */
export const STEM = 'M 24 39 L 40 39 L 40 74 L 48 74 L 48 87 L 24 87 Z'

/** What the two paths cover, so the mark can be centred. */
const GLYPH_BOX = { x: 24, y: 13, width: 63, height: 75 }

/** Softens every corner by half its width, the way the printed mark reads. */
export const CORNER_SOFTEN = 2

/** A square glyph in a round plate needs more margin than in a square one. */
const FILL = 0.62

/** Scales the mark to `fill` of the box and centres it on (cx, cy). */
function glyphTransform(fill: number, cx = 50, cy = 50): string {
  const scale = (100 * fill) / Math.max(GLYPH_BOX.width, GLYPH_BOX.height)
  const x = cx - (GLYPH_BOX.x + GLYPH_BOX.width / 2) * scale
  const y = cy - (GLYPH_BOX.y + GLYPH_BOX.height / 2) * scale
  return `translate(${x} ${y}) scale(${scale})`
}

export const GLYPH_TRANSFORM = glyphTransform(FILL)
