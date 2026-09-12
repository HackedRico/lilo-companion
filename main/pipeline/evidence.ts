import type { Card, Concept, RoleFamily } from '../../shared/types.ts'
import type { LlmLike } from '../llm/service.ts'
import type { Ikb } from '../ikb/load.ts'
import { cardFrom, evidenceFor } from '../ikb/search.ts'
import { translate } from './translate.ts'

/**
 * A card with no surviving terms is still a card. Saying a concept is rarely
 * advertised is true and useful; inventing evidence for it would not be.
 */
export async function buildCard(
  llm: LlmLike,
  ikb: Ikb,
  concept: Concept,
  roles: RoleFamily[]
): Promise<Card> {
  const { terms, oneLiner, sentences } = await translate(llm, ikb, concept, roles)
  if (terms.length === 0) {
    return cardFrom(
      concept,
      [],
      [],
      `Postings for the work you are aiming at barely mention ${concept.name}. That does not make it useless, it just is not what they advertise for.`
    )
  }
  return cardFrom(concept, terms.slice(0, 5), sentences.length > 0 ? sentences : evidenceFor(ikb, terms, roles), oneLiner)
}
