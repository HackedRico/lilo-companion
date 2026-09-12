/**
 * The tray glyph as pixels, with no Electron in it, so it can be looked at by a
 * test rather than by a person squinting at a menu bar.
 *
 * macOS takes a template image and inverts it against the bar itself. Nowhere
 * else says what colour the tray is: a Windows taskbar can be light, dark, or an
 * accent colour, and the app theme setting does not predict it. So off macOS the
 * mark is drawn dark inside a light halo, which reads against all three without
 * reading a registry key or listening for a theme.
 */

/** The glyph's side in points. The tray asks for pixels at its own scale. */
export const PT = 18

/** Scales worth carrying: 18px for a 100% Windows tray, 36px for Retina. */
export const SCALES = [1, 2]

/** How far the halo reaches, in points, so it holds at either scale. */
const HALO = 0.75

/** Samples per axis inside each pixel, for an edge that is not a staircase. */
const SAMPLES = 3

/**
 * One square of BGRA, premultiplied, which is the layout Electron's bitmap
 * constructors take.
 */
export function paint(size: number, template: boolean): Buffer {
  const ink = coverage(size)
  const lit = template ? ink : spread(ink, size, Math.round((HALO * size) / PT))
  const buffer = Buffer.alloc(size * size * 4)
  for (let i = 0; i < ink.length; i++) {
    // Black where the mark is, white where only the halo reaches. Premultiplied,
    // that difference is the colour and the union is the alpha.
    const channel = (lit[i] ?? 0) - (ink[i] ?? 0)
    const at = i * 4
    buffer[at] = channel
    buffer[at + 1] = channel
    buffer[at + 2] = channel
    buffer[at + 3] = lit[i] ?? 0
  }
  return buffer
}

/** How much of each pixel the mark covers, from 0 to 255. */
function coverage(size: number): Uint8Array {
  const out = new Uint8Array(size * size)
  const step = 1 / (SAMPLES + 1)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let hits = 0
      for (let sy = 1; sy <= SAMPLES; sy++) {
        for (let sx = 1; sx <= SAMPLES; sx++) {
          if (inMark((x + sx * step) / size, (y + sy * step) / size)) hits++
        }
      }
      out[y * size + x] = Math.round((hits / (SAMPLES * SAMPLES)) * 255)
    }
  }
  return out
}

/** The mark grown in every direction, which is the halo's outer edge. */
function spread(mark: Uint8Array, size: number, radius: number): Uint8Array {
  if (radius < 1) return mark
  const out = new Uint8Array(mark.length)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let most = 0
      for (let dy = -radius; dy <= radius; dy++) {
        const ny = y + dy
        if (ny < 0 || ny >= size) continue
        for (let dx = -radius; dx <= radius; dx++) {
          const nx = x + dx
          if (nx < 0 || nx >= size) continue
          if (dx * dx + dy * dy > radius * radius) continue
          const value = mark[ny * size + nx] ?? 0
          if (value > most) most = value
        }
      }
      out[y * size + x] = most
    }
  }
  return out
}

/** A bold D in a unit box: a stem joined to a bowl, with the counter cut out. */
function inMark(u: number, v: number): boolean {
  const left = 0.14
  const right = 0.86
  const top = 0.1
  const bottom = 0.9
  const t = 0.185
  const spine = left + 0.26
  const cy = (top + bottom) / 2
  return (
    outside(u, v, left, right, top, bottom, spine, cy) &&
    !outside(u, v, left + t, right - t, top + t, bottom - t, spine, cy)
  )
}

/** Inside the D's outer silhouette: a rectangle to the spine, a half ellipse past it. */
function outside(
  u: number,
  v: number,
  left: number,
  right: number,
  top: number,
  bottom: number,
  spine: number,
  cy: number
): boolean {
  if (v < top || v > bottom || u < left) return false
  if (u <= spine) return true
  const rx = right - spine
  const ry = (bottom - top) / 2
  if (rx <= 0 || ry <= 0) return false
  const dx = (u - spine) / rx
  const dy = (v - cy) / ry
  return dx * dx + dy * dy <= 1
}
