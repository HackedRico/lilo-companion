import type { Point, Size } from '../shared/types.ts'

/**
 * Anything arriving over IPC comes from a renderer, and a renderer must never
 * be able to bring down the main process. Electron throws on a non-finite
 * coordinate rather than ignoring it, so nothing reaches a window untested.
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
