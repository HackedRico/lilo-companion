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
  | { ok: false; reason: 'too_high' | 'unverified' | 'generic' | 'empty' | 'promise' | 'not_a_question' }

/**
 * Whether a hint may be said. Above the ceiling is never said. A line number
 * that is not in the code, or a name that is not there, is never said either.
 * Rung 3 is a claim about their code, so it has to point at their code or it
 * could be said about anyone's work. Rungs 4 and 5 are what to do next, which
 * is new work rather than a line of theirs, so they carry no such duty.
 */
export function gate(hint: Hint, ceiling: Rung, work: Work): Gate {
  if (!hint.say.trim()) return { ok: false, reason: 'empty' }
  // The rung is the model's own claim, so what it actually said is read as well
  // and the higher of the two is what the ceiling answers to. Otherwise a tier
  // is only as strong as a number the model picked.
  if (Math.max(hint.rung, reachedRung(hint, work)) > ceiling) return { ok: false, reason: 'too_high' }
  const lines = lineCount(work.code)
  if (hint.lines.some((line) => line < 1 || line > lines)) return { ok: false, reason: 'unverified' }
  if (hint.names.some((name) => !mentions(work.code, name))) return { ok: false, reason: 'unverified' }
  if (hint.rung === 3 && hint.lines.length === 0 && hint.names.length === 0) return { ok: false, reason: 'generic' }
  // "Here is the working code:" with nothing after it is worse than refusing,
  // because the student is told help is coming and then handed nothing.
  if (hint.rung >= 4 && /:\s*$/.test(hint.say)) return { ok: false, reason: 'promise' }
  // The ceiling is checked against a rung the model chose, so the one rung with
  // a shape worth checking is checked: rung 1 is a question or it is not rung 1.
  // Without this, "your code never matches the brackets" arrives labelled as
  // something to think about, and the lowest tiers quietly give more than they say.
  // One question, not a verdict with a question tagged on the end: "your loop
  // never resets it. See it?" is rung 3 wearing rung 1, and ends in a question
  // mark all the same. A rung 1 hint asks and does not tell.
  if (hint.rung === 1 && !isOneQuestion(hint.say)) return { ok: false, reason: 'not_a_question' }
  return { ok: true }
}

/** A fenced block, or lines that read as code rather than as a sentence. */
export function handsOverCode(say: string): boolean {
  if (say.includes('```')) return true
  const lines = say.split('\n')
  if (lines.length < 2) return false
  return lines.filter((line) => /^\s*(def |class |for |while |if |elif |else:|return |import |[A-Za-z_]\w*\s*(=[^=]|\[))/.test(line)).length >= 2
}

/**
 * Names in the hint that are in the student's own code. Only shapes no English
 * sentence produces are read, so "the loop" is prose and `num_to_index` is not.
 */
export function namesFromCode(say: string, code: string): string[] {
  const tokens = new Set<string>()
  for (const match of say.matchAll(/`([^`\n]{1,40})`/g)) tokens.add((match[1] ?? '').trim())
  for (const [token] of say.matchAll(/\b[A-Za-z_]\w*(?:_\w+)+\b|\b[a-z]+[A-Z]\w*\b/g)) tokens.add(token)
  return [...tokens].filter((token) => token.length > 1 && mentions(code, token))
}

/**
 * The rung a hint reaches by what it says, whatever it calls itself. Code is
 * the top of the ladder however it is labelled, and naming something out of
 * the student's own code is a claim about their code. Below that it is left at
 * one, because saying what it sees is said in code, not asked of a model.
 */
export function reachedRung(hint: Hint, work: Work): Rung {
  if (handsOverCode(hint.say)) return 4
  if (hint.lines.length > 0 || hint.names.length > 0 || namesFromCode(hint.say, work.code).length > 0) return 3
  return 1
}

/** Ends by asking, and says nothing before it that finished with a full stop. */
export function isOneQuestion(say: string): boolean {
  const body = say.trim()
  return /\?["')\]]?$/.test(body) && !/[.!]\s/.test(body)
}

/** Whether a name appears in the code as a whole word. */
export function mentions(code: string, name: string): boolean {
  const trimmed = name.trim()
  if (!trimmed) return false
  const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(?<![A-Za-z0-9_])${escaped}(?![A-Za-z0-9_])`).test(code)
}
