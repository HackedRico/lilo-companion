import type { Hint, Rung } from '../../shared/leetcode.ts'
import { lineCount, type Work } from './state.ts'

/**
 * The rules that make a tier hold. Nothing here asks a model anything: the
 * model proposes a hint with a rung on it, and this decides whether it is
 * said. A model that climbs too high is retried, then withheld.
 */

/** A proactive hint climbs no faster than this. */
export const CLIMB_EVERY = 60000

/** The last hint the companion volunteered, and the code it was about. */
export interface Climb {
  rung: Rung
  at: number
  codeAt: number | null
}

/**
 * The rung a volunteered hint may reach now, or null to stay quiet. It starts
 * at the bottom and rises one rung at a time, only after a minute has passed
 * and the code has changed since the last one: hints are earned, not clicked.
 */
export function nextRung(ceiling: Rung, last: Climb | null, work: Work, now: number): Rung | null {
  if (!work.problem || work.changedAt === null || work.pending || !work.inFront) return null
  if (work.quietUntil !== null && now < work.quietUntil) return null
  if (work.outcome?.verdict === 'accepted') return null
  if (now - work.changedAt < CLIMB_EVERY) return null
  if (last) {
    if (now - last.at < CLIMB_EVERY) return null
    if (last.codeAt === work.changedAt) return null
  }
  const rung = Math.min(ceiling, last ? last.rung + 1 : 1) as Rung
  return rung >= 1 ? rung : null
}

export type Gate =
  | { ok: true }
  | { ok: false; reason: 'too_high' | 'unverified' | 'generic' | 'empty' }

/**
 * Whether a hint may be said. Above the ceiling is never said. A line number
 * that is not in the code, or a name that is not there, is never said either,
 * and from the rung that points at the work upward the hint has to point at
 * something real, or it could be said about anyone's work.
 */
export function gate(hint: Hint, ceiling: Rung, work: Work): Gate {
  if (!hint.say.trim()) return { ok: false, reason: 'empty' }
  if (hint.rung > ceiling) return { ok: false, reason: 'too_high' }
  const lines = lineCount(work.code)
  if (hint.lines.some((line) => line < 1 || line > lines)) return { ok: false, reason: 'unverified' }
  if (hint.names.some((name) => !mentions(work.code, name))) return { ok: false, reason: 'unverified' }
  if (hint.rung >= 3 && hint.lines.length === 0 && hint.names.length === 0) return { ok: false, reason: 'generic' }
  return { ok: true }
}

/** Whether a name appears in the code as a whole word. */
export function mentions(code: string, name: string): boolean {
  const trimmed = name.trim()
  if (!trimmed) return false
  const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(?<![A-Za-z0-9_])${escaped}(?![A-Za-z0-9_])`).test(code)
}
