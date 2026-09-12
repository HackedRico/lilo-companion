import { z } from 'zod'
import { ROLE_FAMILIES } from './types.ts'

/**
 * Every model response is parsed through one of these. Featherless supports
 * JSON mode but not schema enforcement, so nothing reaches the rest of the app
 * without passing through here.
 */

/**
 * The prompt asks for an empty list when nothing is being taught, and a model
 * that has nothing to say says it by leaving the list out: hand it a
 * conference deck and three replies in four are `{}`. That is the answer, not
 * a fault, so a missing list reads as an empty one rather than throwing a
 * schema error at a student who only uploaded a file.
 */
export const conceptsOut = z.object({
  concepts: z
    .array(
      z.object({
        name: z.string().min(2).max(80),
        summary: z.string().min(5).max(400),
        confidence: z.enum(['low', 'medium', 'high'])
      })
    )
    .max(4)
    .default([])
})

export const termsOut = z.object({
  terms: z.array(z.string().min(2).max(60)).max(8),
  oneLiner: z.string().min(10).max(240)
})

export const runtimeSkillOut = z.object({
  skill: z.string().max(80),
  citations: z.array(z.string().min(1).max(80)).max(5),
  oneLiner: z.string().min(10).max(240)
})

export const profileOut = z.object({
  major: z.string().max(80),
  year: z.string().max(40),
  courses: z.array(z.string().max(80)).max(10),
  targetRoles: z.array(z.enum(ROLE_FAMILIES)).max(3),
  interests: z.array(z.string().max(60)).max(8)
})

/**
 * A dry run beside a hint. Only the shape is checked here. Whether it holds
 * together, one value per column, every mark on an item, every line in the
 * code, is the gate's to decide, so a loose reply is refused with a reason
 * rather than thrown away as unparseable.
 */
export const traceOut = z.object({
  input: z.string().max(240),
  items: z.array(z.string().max(24)).max(32),
  columns: z.array(z.string().max(24)).max(8),
  steps: z
    .array(
      z.object({
        values: z.array(z.string().max(60)).max(8),
        marks: z.array(z.object({ at: z.number().int(), label: z.string().max(12) })).max(6),
        note: z.string().max(200),
        line: z.number().int().nullable().optional()
      })
    )
    .max(20)
})

/**
 * A hint from the coach. The rung is the model's own claim about how much it
 * gave away; the gate in main/leetcode/ladder.ts is what decides whether the
 * hint is said, so the bounds here only keep the shape honest.
 */
export const hintOut = z.object({
  rung: z.number().int().min(0).max(5),
  // Long, because the top of the ladder hands over code, and a reply cut off
  // mid-string is a reply that never parses. Wider than the token budget can
  // produce, so the schema is never the thing that refuses an answer.
  say: z.string().max(6000),
  lines: z.array(z.number().int()).max(6),
  names: z.array(z.string().max(40)).max(6),
  // Absent as well as null, because a small model leaves out what it has nothing for.
  trace: traceOut.nullable().optional()
})

export type ConceptsOut = z.infer<typeof conceptsOut>
export type TermsOut = z.infer<typeof termsOut>
export type RuntimeSkillOut = z.infer<typeof runtimeSkillOut>
export type ProfileOut = z.infer<typeof profileOut>
export type TraceOut = z.infer<typeof traceOut>
export type HintOut = z.infer<typeof hintOut>
