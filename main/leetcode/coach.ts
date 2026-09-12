import type { Hint, Rung } from '../../shared/leetcode.ts'
import { hintOut } from '../../shared/schemas.ts'
import { coachHint } from '../../shared/prompts.ts'
import type { LlmLike } from '../llm/service.ts'
import { gate } from './ladder.ts'
import { describe, type Work } from './state.ts'

export type Coached =
  | { kind: 'hint'; hint: Hint }
  /** There was something to say and the ceiling stopped it. Said honestly. */
  | { kind: 'withheld'; say: string }
  /** Nothing specific enough to say, so nothing is said. */
  | { kind: 'silent' }

export const WITHHELD = 'I have a thought, but it is above the level you set. Raise it in settings if you want it.'

/**
 * One hint, gated. The model is asked once, checked, asked once more under a
 * stricter instruction if the first reply broke a rule, and then either said,
 * withheld with an honest line, or dropped. The model is never the enforcer.
 */
export async function coach(
  llm: LlmLike,
  work: Work,
  ceiling: Rung,
  question: string | null,
  now: number
): Promise<Coached> {
  if (!work.problem) return { kind: 'silent' }
  const ask = (retry: 'too_high' | 'unverified' | null) =>
    llm.json(hintOut, {
      lane: 'strong',
      temperature: 0.4,
      maxTokens: 300,
      ...coachHint({
        problem: work.problem!,
        state: describe(work, now),
        code: work.code,
        language: work.language,
        ceiling,
        question,
        retry
      })
    })

  const first = asHint(await ask(null))
  const verdict = gate(first, ceiling, work)
  if (verdict.ok) return { kind: 'hint', hint: first }
  if (verdict.reason === 'empty') return { kind: 'silent' }

  const retry = verdict.reason === 'too_high' ? 'too_high' : 'unverified'
  const second = asHint(await ask(retry))
  const again = gate(second, ceiling, work)
  if (again.ok) return { kind: 'hint', hint: second }
  if (again.reason === 'too_high') return { kind: 'withheld', say: WITHHELD }
  return { kind: 'silent' }
}

function asHint(out: { rung: number; say: string; lines: number[]; names: string[] }): Hint {
  return { rung: out.rung as Rung, say: out.say.trim(), lines: out.lines, names: out.names }
}
