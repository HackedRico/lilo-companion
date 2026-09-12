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

export const scenarioOut = z.object({
  title: z.string().min(3).max(90),
  format: z.enum(['jira', 'slack', 'email']),
  from: z.object({ name: z.string().min(2).max(40), role: z.string().min(2).max(60) }),
  persona: z.string().min(10).max(600),
  visibleMessage: z.string().min(20).max(900),
  attachment: z.object({
    type: z.enum(['table', 'code', 'none']),
    content: z.string().max(1200)
  }),
  hiddenFacts: z
    .array(
      z.object({
        id: z.string().min(1).max(24),
        fact: z.string().min(5).max(300),
        revealWhen: z.string().min(5).max(300)
      })
    )
    .min(2)
    .max(5),
  deliverable: z.string().min(5).max(240),
  classVersion: z.string().min(5).max(240),
  rubric: z.array(z.string().min(5).max(240)).min(3).max(7)
})

export const revealOut = z.object({
  revealedFactIds: z.array(z.string().max(24)).max(5)
})

export const reviewOut = z.object({
  verdict: z.enum(['ship_it', 'needs_changes']),
  strengths: z.array(z.string().max(240)).max(4),
  gaps: z.array(z.string().max(240)).max(4),
  missedTopics: z.array(z.string().max(80)).max(4),
  seniorQuestion: z.string().min(5).max(300)
})

export const profileOut = z.object({
  major: z.string().max(80),
  year: z.string().max(40),
  courses: z.array(z.string().max(80)).max(10),
  targetRoles: z.array(z.enum(ROLE_FAMILIES)).max(3),
  interests: z.array(z.string().max(60)).max(8)
})

export type ConceptsOut = z.infer<typeof conceptsOut>
export type TermsOut = z.infer<typeof termsOut>
export type ScenarioOut = z.infer<typeof scenarioOut>
export type RevealOut = z.infer<typeof revealOut>
export type ReviewOut = z.infer<typeof reviewOut>
export type ProfileOut = z.infer<typeof profileOut>
