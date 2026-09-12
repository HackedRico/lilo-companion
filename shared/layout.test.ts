import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  GAP,
  ORB,
  PAD,
  PANEL,
  PANEL_MIN,
  choosePlacement,
  clampToWork,
  collapsedLayout,
  cornerOf,
  expandedLayout,
  fitPanel
} from './layout.ts'
import type { Placement, Rect, Size } from './types.ts'

const WORK: Rect = { x: 0, y: 0, width: 1600, height: 900 }

const PLACEMENTS: Placement[] = [
  { side: 'right', edge: 'down' },
  { side: 'right', edge: 'up' },
  { side: 'left', edge: 'down' },
  { side: 'left', edge: 'up' }
]

test('collapsed is the orb with room for it to breathe', () => {
  const layout = collapsedLayout()
  assert.deepEqual(layout.window, { width: ORB + PAD * 2, height: ORB + PAD * 2 })
  assert.deepEqual(layout.orb, { x: PAD, y: PAD, width: ORB, height: ORB })
  assert.equal(layout.panel, null)
})

test('padding stays only on the orb side, so the panel ends at the window edge', () => {
  for (const placement of PLACEMENTS) {
    const { window, orb, panel } = expandedLayout(PANEL, placement)
    assert.ok(orb && panel, `${placement.side}/${placement.edge} draws both`)

    const toOrb =
      placement.side === 'right' ? panel.x - (orb.x + ORB) : orb.x - (panel.x + panel.width)
    assert.equal(toOrb, GAP, `${placement.side}/${placement.edge} keeps the gap`)

    const farEdge = placement.side === 'right' ? window.width - (panel.x + panel.width) : panel.x
    assert.equal(farEdge, 0, `${placement.side}/${placement.edge} panel reaches the far edge`)

    const orbPad = placement.side === 'right' ? orb.x : window.width - (orb.x + ORB)
    assert.equal(orbPad, PAD, `${placement.side}/${placement.edge} pads the orb side`)
  }
})

test('the panel aligns with the orb edge it opened from', () => {
  const down = expandedLayout(PANEL, { side: 'right', edge: 'down' })
  assert.equal(down.panel?.y, down.orb?.y)
  assert.equal(down.panel!.y + PANEL.height, down.window.height)

  const up = expandedLayout(PANEL, { side: 'right', edge: 'up' })
  assert.equal(up.panel!.y + PANEL.height, up.orb!.y + ORB)
  assert.equal(up.panel?.y, 0)
})

test('a panel shorter than the orb still leaves it room to breathe', () => {
  const short: Size = { width: 320, height: 40 }
  for (const placement of PLACEMENTS) {
    const { window, orb } = expandedLayout(short, placement)
    assert.equal(window.height, ORB + PAD * 2)
    assert.equal(orb?.y, PAD)
  }
})

test('the orb keeps its place on screen when the panel opens', () => {
  const onScreen = { x: 1200, y: 700 }
  for (const placement of PLACEMENTS) {
    const layout = expandedLayout(PANEL, placement)
    const origin = { x: onScreen.x - layout.orb!.x, y: onScreen.y - layout.orb!.y }
    assert.deepEqual({ x: origin.x + layout.orb!.x, y: origin.y + layout.orb!.y }, onScreen)
  }
})

test('the panel opens toward whichever side has more room', () => {
  assert.deepEqual(choosePlacement({ x: 40, y: 40 }, WORK), { side: 'right', edge: 'down' })
  assert.deepEqual(choosePlacement({ x: 1480, y: 780 }, WORK), { side: 'left', edge: 'up' })
  assert.deepEqual(choosePlacement({ x: 1480, y: 40 }, WORK), { side: 'left', edge: 'down' })
})

test('a window is pulled back on screen', () => {
  const off: Rect = { x: 1500, y: 850, width: 500, height: 400 }
  const pulled = clampToWork(off, WORK)
  assert.equal(pulled.x + pulled.width, WORK.width)
  assert.equal(pulled.y + pulled.height, WORK.height)
})

test('a screen too small for the panel shrinks it rather than clipping it', () => {
  const small: Rect = { x: 0, y: 0, width: 600, height: 400 }
  const fitted = fitPanel(small)
  assert.ok(fitted.width <= small.width - PAD - ORB - GAP)
  assert.ok(fitted.height <= small.height - PAD)
  assert.deepEqual(fitPanel(WORK), PANEL)
})

test('a size the student dragged to is the size they get', () => {
  const wanted: Size = { width: 520, height: 700 }
  assert.deepEqual(fitPanel(WORK, wanted), wanted)
})

test('a panel dragged too small is held at the size it stays readable', () => {
  const fitted = fitPanel(WORK, { width: 40, height: 40 })
  assert.deepEqual(fitted, PANEL_MIN)
})

test('the display beats the minimum, because clipping is worse than cramped', () => {
  const small: Rect = { x: 0, y: 0, width: 300, height: 260 }
  const fitted = fitPanel(small, PANEL)
  assert.ok(fitted.width < PANEL_MIN.width, 'narrower than the minimum rather than off the screen')
  assert.ok(fitted.height < PANEL_MIN.height)
  assert.ok(fitted.width <= small.width - PAD - ORB - GAP)
  assert.ok(fitted.height <= small.height - PAD)
})

test('a size dragged on a big display comes back fitted to a small one', () => {
  const laptop: Rect = { x: 0, y: 0, width: 1280, height: 700 }
  const fitted = fitPanel(laptop, { width: 900, height: 1400 })
  assert.equal(fitted.height, laptop.height - PAD)
  assert.equal(fitted.width, 900, 'the width still fitted, so it was left alone')
})

test('the corner to drag is the one the orb is not standing next to', () => {
  for (const placement of PLACEMENTS) {
    const layout = expandedLayout(PANEL, placement)
    assert.ok(layout.panel && layout.orb, 'an expanded layout has both')
    assert.deepEqual(
      cornerOf(layout.panel, layout.orb),
      placement,
      `${placement.side}/${placement.edge} puts the handle opposite the orb`
    )
  }
})
