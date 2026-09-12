import type { Hint, Rung, Trace } from '../../shared/leetcode.ts'
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
  | {
      ok: false
      reason: 'too_high' | 'unverified' | 'broken_trace' | 'generic' | 'empty' | 'promise' | 'not_a_question'
    }

/**
 * Whether a hint may be said. Above the ceiling is never said. A line number
 * that is not in the code, or a name that is not there, is never said either.
 * Rung 3 is a claim about their code, so it has to point at their code or it
 * could be said about anyone's work. Rungs 4 and 5 are what to do next, which
 * is new work rather than a line of theirs, so they carry no such duty. A dry
 * run beside the words is read under the same rules, and drawn only if it
 * holds together.
 */
export function gate(hint: Hint, ceiling: Rung, work: Work): Gate {
  if (!hint.say.trim()) return { ok: false, reason: 'empty' }
  // The rung is the model's own claim, so what it actually said is read as well
  // and the higher of the two is what the ceiling answers to. Otherwise a tier
  // is only as strong as a number the model picked.
  if (Math.max(hint.rung, reachedRung(hint, work)) > ceiling) return { ok: false, reason: 'too_high' }
  const lines = lineCount(work.code)
  const named = [...hint.lines, ...(hint.trace ? traceLines(hint.trace) : [])]
  if (named.some((line) => line < 1 || line > lines)) return { ok: false, reason: 'unverified' }
  if (hint.names.some((name) => !mentions(work.code, name))) return { ok: false, reason: 'unverified' }
  if (hint.trace && !holdsTogether(hint.trace)) return { ok: false, reason: 'broken_trace' }
  const pointed = hint.lines.length > 0 || hint.names.length > 0 || (hint.trace !== undefined && tracesTheirCode(hint.trace, work.code))
  if (hint.rung === 3 && !pointed) return { ok: false, reason: 'generic' }
  // "Here is the working code:" with nothing after it is worse than refusing,
  // because the student is told help is coming and then handed nothing. A say
  // that ends by introducing the picture has kept its promise.
  if (hint.rung >= 4 && hint.trace === undefined && /:\s*$/.test(hint.say)) return { ok: false, reason: 'promise' }
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
 * the student's own code is a claim about their code. A dry run is read the
 * same way, and a dry run of anything is at least the idea drawn. Below that
 * it is left at one, because saying what it sees is said in code, not asked
 * of a model.
 */
export function reachedRung(hint: Hint, work: Work): Rung {
  if (handsOverCode(hint.say) || (hint.trace !== undefined && codeInTrace(hint.trace))) return 4
  if (hint.lines.length > 0 || hint.names.length > 0 || namesFromCode(hint.say, work.code).length > 0) return 3
  if (hint.trace !== undefined && tracesTheirCode(hint.trace, work.code)) return 3
  if (hint.trace !== undefined) return 2
  return 1
}

/** The lines of their code a dry run stands on. */
function traceLines(trace: Trace): number[] {
  return trace.steps.flatMap((step) => (step.line === null || step.line === undefined ? [] : [step.line]))
}

/** Everything in a dry run that is written rather than placed: read for names and for code. */
function traceProse(trace: Trace): string[] {
  return [trace.input, ...trace.steps.flatMap((step) => [step.note, ...step.values])]
}

/**
 * Whether a dry run is of their code rather than of the idea: it stands on a
 * line of theirs or tracks a name of theirs. A column or a mark is an
 * identifier by construction, so each is checked as a whole word against the
 * code, where prose is only read for the shapes no sentence produces.
 */
export function tracesTheirCode(trace: Trace, code: string): boolean {
  if (traceLines(trace).length > 0) return true
  const labels = trace.steps.flatMap((step) => step.marks.map((mark) => mark.label))
  if ([...trace.columns, ...labels].some((name) => mentions(code, name))) return true
  return namesFromCode(traceProse(trace).join('\n'), code).length > 0
}

/** A statement rather than a sentence: an assignment, a return, a definition. */
const STATEMENT = /^\s*(def|class|import|return)\b|[A-Za-z_][\w.]*(\[[^\]]*\])*\s*=[^=]/

/**
 * Whether the steps of a dry run are code in pieces. A fenced block anywhere
 * is, and so are two steps written as statements: "sum 17 is over 9" is what
 * happened, "seen[n] = i" is their next line. "if" opens a sentence as often
 * as a branch, so a keyword alone is not read as code here.
 */
export function codeInTrace(trace: Trace): boolean {
  const written = trace.steps.flatMap((step) => [step.note, ...step.values])
  if (written.some((text) => text.includes('```'))) return true
  return written.filter((text) => STATEMENT.test(text)).length >= 2
}

/**
 * Whether a dry run holds together: one value per column in every step, and
 * every mark standing on an item that exists. A mark off the end of the array
 * is a claim about a cell that is not there.
 */
export function holdsTogether(trace: Trace): boolean {
  return trace.steps.every(
    (step) =>
      step.values.length === trace.columns.length &&
      step.marks.every((mark) => mark.at >= 0 && mark.at < trace.items.length && mark.label.trim().length > 0)
  )
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
