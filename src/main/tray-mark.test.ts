import assert from 'node:assert/strict'
import { test } from 'node:test'
import { PT, SCALES, paint } from './tray-mark.ts'

/** The four channels of one pixel, read out of a premultiplied BGRA square. */
function pixel(buffer: Buffer, size: number, x: number, y: number): number[] {
  const at = (y * size + x) * 4
  return [buffer[at] ?? 0, buffer[at + 1] ?? 0, buffer[at + 2] ?? 0, buffer[at + 3] ?? 0]
}

/** Where the stem is solid, at any size. */
function onStem(size: number): { x: number; y: number } {
  return { x: Math.round(size * 0.2), y: Math.round(size * 0.5) }
}

test('every scale the tray can ask for is drawn', () => {
  for (const scale of SCALES) {
    const size = PT * scale
    assert.equal(paint(size, false).length, size * size * 4, `${scale}x is a full square`)
  }
})

test('a template image is black at whatever alpha the mark has', () => {
  const size = PT * 2
  const buffer = paint(size, true)
  const stem = onStem(size)
  const [b, g, r, a] = pixel(buffer, size, stem.x, stem.y)
  assert.equal(a, 255, 'the stem is opaque')
  assert.deepEqual([b, g, r], [0, 0, 0], 'macOS inverts it, so the colour carries nothing')
})

test('off macOS the mark is dark and the halo around it is light', () => {
  const size = PT * 2
  const buffer = paint(size, false)
  const stem = onStem(size)
  const [, , , inkAlpha] = pixel(buffer, size, stem.x, stem.y)
  assert.equal(inkAlpha, 255, 'the stem is opaque')
  assert.deepEqual(pixel(buffer, size, stem.x, stem.y).slice(0, 3), [0, 0, 0], 'the mark itself is black')

  // Just outside the stem's left edge: the halo, not the mark.
  const outside = pixel(buffer, size, stem.x - 3, stem.y)
  assert.equal(outside[3], 255, 'the halo is opaque')
  assert.deepEqual(outside.slice(0, 3), [255, 255, 255], 'and white, so a light taskbar cannot swallow it')
})

test('the halo does not fill the whole square', () => {
  const size = PT * 2
  const buffer = paint(size, false)
  const [, , , corner] = pixel(buffer, size, 0, 0)
  assert.equal(corner, 0, 'the corner stays clear or the tray shows a block')
})

test('a mark drawn with no halo is the mark drawn with one, minus the light', () => {
  const size = PT * 2
  const template = paint(size, true)
  const halved = paint(size, false)
  let inked = 0
  for (let i = 0; i < size * size; i++) {
    const alpha = template[i * 4 + 3] ?? 0
    if (alpha === 0) continue
    inked++
    // Wherever the mark has ink, the haloed square is at least as opaque.
    assert.ok((halved[i * 4 + 3] ?? 0) >= alpha, 'the halo never eats the mark')
  }
  assert.ok(inked > size, 'the mark is actually drawn')
})
