import type { Concept } from '../../shared/types.ts'
import { termsOut } from '../../shared/schemas.ts'
import { translateConcept } from '../../shared/prompts.ts'
import type { LlmLike } from '../llm/provider.ts'
import type { Ikb } from '../ikb/load.ts'
import { nearbyTerms, resolveTerms, type TermHit } from '../ikb/search.ts'

export interface Translation {
  terms: TermHit[]
  oneLiner: string
  /** What the model offered, before the postings had their say. */
  proposed: string[]
}

/**
 * The model proposes; the postings decide. A term nobody advertises for is
 * dropped rather than shown, so a card can only ever claim what is in the data.
 */
export async function translate(llm: LlmLike, ikb: Ikb, concept: Concept): Promise<Translation> {
  // A menu drawn from the postings nearest the concept, not the whole vocabulary.
  const vocabulary = nearbyTerms(ikb, `${concept.name} ${concept.summary}`)
  const reply = await llm.json(termsOut, {
    lane: 'fast',
    ...translateConcept(concept.name, concept.summary, vocabulary)
  })
  return {
    terms: resolveTerms(ikb, reply.terms),
    oneLiner: reply.oneLiner.trim(),
    proposed: reply.terms
  }
}
