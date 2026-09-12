import type { Point, Size } from '../shared/types.ts'
import { LOUDEST_BYTES } from '../shared/voice.ts'

/**
 * Anything arriving over IPC comes from a renderer, and a renderer must never
 * be able to bring down the main process. Electron throws on a non-finite
 * coordinate rather than ignoring it, so nothing reaches a window unchecked.
 */
export function asPoint(value: unknown): Point | null {
  if (typeof value !== 'object' || value === null) return null
  const { x, y } = value as Record<string, unknown>
  if (typeof x !== 'number' || typeof y !== 'number') return null
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null
  return { x, y }
}

/** A size the student dragged to, in the same spirit as asPoint. */
export function asSize(value: unknown): Size | null {
  if (typeof value !== 'object' || value === null) return null
  const { width, height } = value as Record<string, unknown>
  if (typeof width !== 'number' || typeof height !== 'number') return null
  if (!Number.isFinite(width) || !Number.isFinite(height)) return null
  if (width <= 0 || height <= 0) return null
  return { width, height }
}

export function asText(value: unknown, limit = 8000): string {
  return typeof value === 'string' ? value.slice(0, limit) : ''
}

/**
 * A recording from the microphone, in whichever container the bridge put the
 * bytes in, and never one that would hold the transcriber for minutes.
 */
export function asAudio(value: unknown, limit = LOUDEST_BYTES): Uint8Array | null {
  const bytes =
    value instanceof ArrayBuffer ? new Uint8Array(value) : value instanceof Uint8Array ? value : null
  if (!bytes || bytes.byteLength === 0 || bytes.byteLength > limit) return null
  return bytes
}
