import { VERDICT_LABEL, type Outcome, type Problem, type Tier, type WorkEvent } from '../../shared/leetcode.ts'

/**
 * What the companion knows about the student's work on the page, folded from
 * events. Pure, so a recording folds to the same state the live page did.
 */
export interface Work {
  problem: Problem | null
  code: string
  language: string
  /** When the code last changed, so a hint can wait for effort. */
  changedAt: number | null
  outcome: Outcome | null
  outcomeAt: number | null
  /** A run or submit is in flight, so the verdict on file is stale. */
  pending: boolean
  inFront: boolean
  /** Outcomes since the problem opened, accepted or not. */
  attempts: number
  tier: Tier
  quietUntil: number | null
}

export const EMPTY_WORK: Work = {
  problem: null,
  code: '',
  language: '',
  changedAt: null,
  outcome: null,
  outcomeAt: null,
  pending: false,
  inFront: false,
  attempts: 0,
  tier: 'coach',
  quietUntil: null
}

/** How long "quiet for a bit" lasts. */
export const QUIET_MS = 10 * 60 * 1000

export function fold(work: Work, event: WorkEvent): Work {
  switch (event.kind) {
    case 'opened':
      // A new problem is a clean slate, apart from what the student chose.
      return { ...EMPTY_WORK, tier: work.tier, quietUntil: work.quietUntil, inFront: work.inFront, problem: event.problem }
    case 'closed':
      return { ...EMPTY_WORK, tier: work.tier, quietUntil: work.quietUntil, inFront: work.inFront }
    case 'changed':
      if (event.code === work.code && event.language === work.language) return work
      return { ...work, code: event.code, language: event.language, changedAt: event.at }
    case 'pending':
      return { ...work, pending: true }
    case 'outcome':
      return { ...work, pending: false, outcome: event.outcome, outcomeAt: event.at, attempts: work.attempts + 1 }
    case 'attention':
      return { ...work, inFront: event.inFront }
    case 'ceiling':
      return { ...work, tier: event.tier }
    case 'quiet':
      return { ...work, quietUntil: event.at + QUIET_MS }
    case 'asked':
    case 'help':
      return work
  }
}

export function lineCount(code: string): number {
  return code.length === 0 ? 0 : code.split('\n').length
}

/** "just now", "40 seconds ago", "3 minutes ago". */
export function ago(then: number, now: number): string {
  const seconds = Math.max(0, Math.round((now - then) / 1000))
  if (seconds < 10) return 'just now'
  if (seconds < 60) return `${seconds} seconds ago`
  const minutes = Math.round(seconds / 60)
  return `${minutes} minute${minutes === 1 ? '' : 's'} ago`
}

/** The verdict as one plain sentence, with the failing case where there is one. */
export function describeOutcome(outcome: Outcome): string {
  if (outcome.verdict === 'accepted') return 'The last run was accepted.'
  const verdict = VERDICT_LABEL[outcome.verdict]
  const parts = [
    outcome.input ? `input ${outcome.input.trim()}` : '',
    outcome.expected ? `expected ${outcome.expected.trim()}` : '',
    outcome.output ? `got ${outcome.output.trim()}` : ''
  ].filter(Boolean)
  if (parts.length > 0) return `The last run came back ${verdict}: ${parts.join(', ')}.`
  if (outcome.detail) return `The last run came back ${verdict}: ${outcome.detail.trim().slice(0, 200)}`
  return `The last run came back ${verdict}.`
}

/**
 * The state read back in words that need no model. This is the floor: the
 * same at every tier, and the first thing said before any advice.
 */
export function describe(work: Work, now: number): string {
  if (!work.problem) return 'Nothing open on LeetCode.'
  const head = `${work.problem.title}, ${work.problem.difficulty.toLowerCase() || 'unrated'}.`
  const lines = lineCount(work.code)
  const code =
    lines === 0
      ? 'Nothing written yet.'
      : `${lines} line${lines === 1 ? '' : 's'} of ${work.language || 'code'}, last changed ${ago(work.changedAt ?? now, now)}.`
  const run = work.pending ? 'A run is in flight.' : work.outcome ? describeOutcome(work.outcome) : ''
  return [head, code, run].filter(Boolean).join(' ')
}
