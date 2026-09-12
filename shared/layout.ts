import type { Edge, Layout, Placement, Point, Rect, Side, Size } from './types.ts'

/** The orb's side, in points. Everything else is measured from it. */
export const ORB = 56

/** Room around the orb for the breathe and the lock-in ring. */
export const PAD = 16

/** Between the orb and the panel. */
export const GAP = 12

/** The panel before anyone has dragged its corner. */
export const PANEL: Size = { width: 380, height: 520 }

/** Under this the thread stops being a conversation and starts being a slot. */
export const PANEL_MIN: Size = { width: 300, height: 320 }

/** A whisper is one short line, so it gets a fixed strip beside the orb. */
export const WHISPER: Size = { width: 232, height: 56 }

/** How far from the screen edge the orb sits on first launch. */
export const FIRST_INSET = 28

export function collapsedLayout(): Layout {
  const side = ORB + PAD * 2
  return {
    window: { width: side, height: side },
    orb: { x: PAD, y: PAD, width: ORB, height: ORB },
    panel: null,
    whisper: null
  }
}

/**
 * The panel beside the orb, with padding only on the orb's side, so the panel's
 * far edges are the window's own edges.
 */
export function expandedLayout(panel: Size, placement: Placement): Layout {
  const width = PAD + ORB + GAP + panel.width
  const height = Math.max(ORB + PAD * 2, panel.height + PAD)
  const orbX = placement.side === 'right' ? PAD : width - PAD - ORB
  const orbY = placement.edge === 'down' ? PAD : height - PAD - ORB
  return {
    window: { width, height },
    orb: { x: orbX, y: orbY, width: ORB, height: ORB },
    panel: {
      x: placement.side === 'right' ? orbX + ORB + GAP : 0,
      y: placement.edge === 'down' ? orbY : orbY + ORB - panel.height,
      width: panel.width,
      height: panel.height
    },
    whisper: null
  }
}

/**
 * The orb plus room for one line beside it. Same geometry as the panel, so a
 * whisper opens on the same side the panel would.
 */
export function whisperLayout(placement: Placement): Layout {
  const base = expandedLayout(WHISPER, placement)
  const whisper = base.panel
  return {
    window: base.window,
    orb: base.orb,
    panel: null,
    // Centred on the orb rather than aligned to an edge: it is a label, not a panel.
    whisper:
      whisper && base.orb
        ? { ...whisper, y: base.orb.y + (ORB - WHISPER.height) / 2 }
        : null
  }
}

/** Whichever side has more room, horizontally and vertically. */
export function choosePlacement(orb: Point, work: Rect): Placement {
  const roomRight = work.x + work.width - (orb.x + ORB)
  const roomLeft = orb.x - work.x
  const roomDown = work.y + work.height - orb.y
  const roomUp = orb.y + ORB - work.y
  const side: Side = roomRight >= roomLeft ? 'right' : 'left'
  const edge: Edge = roomDown >= roomUp ? 'down' : 'up'
  return { side, edge }
}

export function clampToWork(bounds: Rect, work: Rect): Rect {
  const x = Math.min(Math.max(bounds.x, work.x), work.x + work.width - bounds.width)
  const y = Math.min(Math.max(bounds.y, work.y), work.y + work.height - bounds.height)
  return { ...bounds, x: Math.round(x), y: Math.round(y) }
}

/**
 * The size asked for, held above what the panel needs to stay readable and
 * below what the display can show. The display wins outright: a panel that will
 * not fit the screen is shrunk to it rather than clipped, even if that takes it
 * under the minimum.
 */
export function fitPanel(work: Rect, wanted: Size = PANEL): Size {
  const room: Size = { width: work.width - PAD - ORB - GAP, height: work.height - PAD }
  return {
    width: Math.min(Math.max(wanted.width, PANEL_MIN.width), room.width),
    height: Math.min(Math.max(wanted.height, PANEL_MIN.height), room.height)
  }
}

/**
 * The panel's free corner: the one diagonally opposite the orb. It is the only
 * corner that can be dragged without dragging the orb along with it, because
 * the orb is the fixed point the whole layout is measured from.
 */
export function cornerOf(panel: Rect, orb: Rect): Placement {
  return {
    side: panel.x >= orb.x ? 'right' : 'left',
    edge: panel.y >= orb.y ? 'down' : 'up'
  }
}
