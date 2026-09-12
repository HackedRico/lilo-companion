import type { Hint, Rung } from '../../shared/leetcode.ts'
import { hintOut, type HintOut } from '../../shared/schemas.ts'
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
 * The same, with nobody asking. What a tier volunteers stops lower than what it
 * answers, so on tutor the level is already as high as it goes and "raise it in
 * settings" would be a lie: the door there is to ask.
 */
export const WITHHELD_UNASKED = 'I have a thought, but it is more than I give you unasked. Ask me for it, or raise the level in settings.'

/** Why the first reply was refused, in the words the prompt answers to. */
type Retry = 'too_high' | 'unverified' | 'broken_trace' | 'promise' | 'not_a_question' | 'generic' | null

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
  const ask = (retry: Retry) =>
    llm.json(hintOut, {
      lane: 'strong',
      // Nobody asked for a volunteered hint, so it never makes a student wait.
      unasked: question === null,
      temperature: 0.4,
      // The steps and the answer are long, a dry run is longer than its words,
      // and a truncated reply is no reply at all.
      maxTokens: ceiling >= 4 ? 1800 : 1000,
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

  // 'empty' already returned above, so whatever is left names the fault plainly.
  const retry: Retry = verdict.reason
  const second = asHint(await ask(retry))
  const again = gate(second, ceiling, work)
  if (again.ok) return { kind: 'hint', hint: second }
  if (again.reason === 'too_high') return { kind: 'withheld', say: question === null ? WITHHELD_UNASKED : WITHHELD }
  return { kind: 'silent' }
}

function asHint(out: HintOut): Hint {
  const hint: Hint = { rung: out.rung as Rung, say: out.say.trim(), lines: out.lines, names: out.names }
  // A dry run with no steps is no dry run, so it is not carried as one.
  if (out.trace && out.trace.steps.length > 0) hint.trace = out.trace
  return hint
}
