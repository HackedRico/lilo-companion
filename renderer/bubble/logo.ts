/**
 * The mark, drawn in code so it renders identically on every machine and scales
 * with the tile. Everything is in a 100 unit box that holds the D and the face,
 * and the box is drawn at 90 percent of the tile, centred.
 *
 * Give another mark its own path and opening rectangle and the face lays itself
 * out from the rectangle.
 */

export const GRADIENT_FROM = '#14a3fa'
export const GRADIENT_TO = '#0d4ff0'

/**
 * One closed path, clockwise from the top left: a cut corner up to the flat
 * top, the outer bowl, the flat bottom, the stem that starts partway down so
 * the opening is open to the left, then in and up the inner bowl.
 */
export const MARK = [
  'M 22 26',
  'L 34 12',
  'L 56 12',
  'C 107 12 107 88 56 88',
  'L 28 88',
  'L 28 48',
  'L 40 48',
  'L 40 74',
  'L 56 74',
  'C 84 74 84 26 56 26',
  'Z'
].join(' ')

/** The rectangle inside the D. The face is positioned from it. */
export const OPENING = { x: 40, y: 26, width: 34, height: 48 } as const

/** How much of the tile the box takes, centred. */
export const BOX_FILL = 0.9

export const BOX_TRANSFORM = `translate(${(100 - 100 * BOX_FILL) / 2} ${(100 - 100 * BOX_FILL) / 2}) scale(${BOX_FILL})`

/** The tile's corner radius as a fraction of its side. */
export const TILE_RADIUS = 0.22
