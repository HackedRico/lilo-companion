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
const HALO = 1

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

/**
 * The mark in a unit square: the same D as the orb, with its stem starting
 * partway down and its opening open to the left. Fitted to 80 percent of the
 * square, in the mark's own 100 unit box.
 */
function inMark(u: number, v: number): boolean {
  const x = 12 + ((u - 0.1) / 0.8) * 82
  const y = 12 + ((v - 0.1) / 0.8) * 76
  if (y < 12 || y > 88) return false
  // The top bar, its corner cut from (22, 26) up to (34, 12).
  if (y <= 26 && x <= 56 && x >= 22 + (26 - y) * (12 / 14)) return true
  // The stem, which starts partway down, and the bottom bar.
  if (x >= 28 && x <= 40 && y >= 48) return true
  if (y >= 74 && x >= 28 && x <= 56) return true
  // The bowl: inside the outer half ellipse and outside the inner one.
  if (x >= 56) return inEllipse(x, y, 56, 50, 38.25, 38) && !inEllipse(x, y, 56, 50, 21, 24)
  return false
}

function inEllipse(x: number, y: number, cx: number, cy: number, rx: number, ry: number): boolean {
  const dx = (x - cx) / rx
  const dy = (y - cy) / ry
  return dx * dx + dy * dy <= 1
}
