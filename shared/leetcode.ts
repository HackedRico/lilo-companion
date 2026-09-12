import { z } from 'zod'

/**
 * The LeetCode practice, as types. What the extension can see on the page
 * arrives as one of these events, and everything above this line is the same
 * on every platform and replayable from a recording.
 */

/**
 * How much of the answer a line gives away. A tier is a ceiling on this
 * ladder, never a personality: nothing below the ceiling changes with it.
 */
export type Rung = 0 | 1 | 2 | 3 | 4 | 5

export const RUNG_LABEL: Record<Rung, string> = {
  0: 'what it sees',
  1: 'a question to think about',
  2: 'the idea by name',
  3: 'where the work goes wrong',
  4: 'the steps',
  5: 'the answer'
}

export type Tier = 'hands_off' | 'coach' | 'tutor'

export const TIERS = ['hands_off', 'coach', 'tutor'] as const

export interface Ceiling {
  /** The highest rung a hint may reach when nobody asked for one. */
  volunteer: Rung
  /** The highest rung an answer may reach when the student asked. */
  onAsk: Rung
}

/**
 * Two ceilings per tier, because what the companion may volunteer is always
 * lower than what it may answer. Hands off volunteers nothing above stating
 * the state and answers one question to think about. Tutor hands over code,
 * and only when asked outright.
 */
export const TIER_CEILING: Record<Tier, Ceiling> = {
  hands_off: { volunteer: 0, onAsk: 1 },
  coach: { volunteer: 2, onAsk: 3 },
  tutor: { volunteer: 4, onAsk: 5 }
}

export const TIER_LABEL: Record<Tier, string> = {
  hands_off: 'Hands off',
  coach: 'Coach',
  tutor: 'Tutor'
}

export const TIER_NOTE: Record<Tier, string> = {
  hands_off: 'Says what it sees and cheers. Asked, it gives you one question to think about.',
  coach: 'Names the idea, and shows where your own code goes wrong. Never the steps.',
  tutor: 'Walks you through the steps. Hands over code only when you ask for it outright.'
}

export type Verdict = 'accepted' | 'wrong_answer' | 'time_limit' | 'runtime_error' | 'compile_error' | 'other'

export const VERDICT_LABEL: Record<Verdict, string> = {
  accepted: 'accepted',
  wrong_answer: 'wrong answer',
  time_limit: 'time limit exceeded',
  runtime_error: 'a runtime error',
  compile_error: 'a compile error',
  other: 'not accepted'
}

const problem = z.object({
  slug: z.string().min(1).max(120),
  title: z.string().min(1).max(200),
  difficulty: z.string().max(20),
  statement: z.string().max(8000)
})

const outcome = z.object({
  verdict: z.enum(['accepted', 'wrong_answer', 'time_limit', 'runtime_error', 'compile_error', 'other']),
  /** What the page said, when it said anything beyond the verdict. */
  detail: z.string().max(2000),
  input: z.string().max(2000).optional(),
  expected: z.string().max(2000).optional(),
  output: z.string().max(2000).optional()
})

const at = z.number().int().nonnegative()

/**
 * The whole vocabulary. Everything the page can tell the companion is one of
 * these, and so is everything the student can ask of it, so a session is a
 * list of them and a list of them is a session.
 */
export const workEvent = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('opened'), at, problem }),
  z.object({ kind: z.literal('closed'), at }),
  z.object({ kind: z.literal('changed'), at, code: z.string().max(20000), language: z.string().max(40) }),
  z.object({ kind: z.literal('pending'), at }),
  z.object({ kind: z.literal('outcome'), at, outcome }),
  z.object({ kind: z.literal('attention'), at, inFront: z.boolean() }),
  z.object({ kind: z.literal('asked'), at, text: z.string().min(1).max(2000) }),
  z.object({ kind: z.literal('ceiling'), at, tier: z.enum(['hands_off', 'coach', 'tutor']) }),
  z.object({ kind: z.literal('help'), at }),
  z.object({ kind: z.literal('quiet'), at })
])

export type WorkEvent = z.infer<typeof workEvent>
export type Problem = z.infer<typeof problem>
export type Outcome = z.infer<typeof outcome>

/** A hint as the model returns it, before the gate has had its say. */
export interface Hint {
  rung: Rung
  say: string
  /** Lines of the student's code the hint is about. */
  lines: number[]
  /** Names in the student's code the hint is about. */
  names: string[]
}

/** What the companion can do on the page: mark lines, and only that. */
export interface Mark {
  lines: number[]
}
