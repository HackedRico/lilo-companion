import { z } from 'zod'
import { ROLE_FAMILIES } from './types.ts'

/**
 * Every model response is parsed through one of these. Featherless supports
 * JSON mode but not schema enforcement, so nothing reaches the rest of the app
 * without passing through here.
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
 * A hint from the coach. The rung is the model's own claim about how much it
 * gave away; the gate in main/leetcode/ladder.ts is what decides whether the
 * hint is said, so the bounds here only keep the shape honest.
 */
export const hintOut = z.object({
  rung: z.number().int().min(0).max(5),
  say: z.string().max(400),
  lines: z.array(z.number().int()).max(6),
  names: z.array(z.string().max(40)).max(6)
})

export type ConceptsOut = z.infer<typeof conceptsOut>
export type TermsOut = z.infer<typeof termsOut>
export type RuntimeSkillOut = z.infer<typeof runtimeSkillOut>
export type ProfileOut = z.infer<typeof profileOut>
export type HintOut = z.infer<typeof hintOut>
