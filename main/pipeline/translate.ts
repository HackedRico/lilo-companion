import type { Concept } from '../../shared/types.ts'
import { runtimeSkillOut, termsOut } from '../../shared/schemas.ts'
import { nameRuntimeSkill, translateConcept } from '../../shared/prompts.ts'
import type { LlmLike } from '../llm/service.ts'
import type { Ikb } from '../ikb/load.ts'
import { conceptEvidenceQueries, mapConceptTerms } from '../ikb/map.ts'
import { evidenceSearch, nearbyTerms, resolveTerms, type TermHit } from '../ikb/search.ts'
import type { Sentence, RoleFamily } from '../../shared/types.ts'

export interface Translation {
  terms: TermHit[]
  oneLiner: string
  /** What the model offered, before the postings had their say. */
  proposed: string[]
  /** Runtime evidence used when no fixed vocabulary term survived. */
  sentences: Sentence[]
}

/**
 * The model proposes; the postings decide. A term nobody advertises for is
 * dropped rather than shown, so a card can only ever claim what is in the data.
 */
export async function translate(
  llm: LlmLike,
  ikb: Ikb,
  concept: Concept,
  roles: RoleFamily[] = []
): Promise<Translation> {
  // A menu drawn from the postings nearest the concept, not the whole vocabulary.
  const mapped = mapConceptTerms(ikb, concept)
  const vocabulary = [...new Set([...mapped.map((term) => term.term), ...nearbyTerms(ikb, `${concept.name} ${concept.summary}`)])]
  const reply = await llm.json(termsOut, {
    lane: 'fast',
    ...translateConcept(concept.name, concept.summary, vocabulary)
  })
  const terms = new Map<string, TermHit>()
  for (const hit of [...mapped, ...resolveTerms(ikb, reply.terms)]) {
    if (!terms.has(hit.term)) terms.set(hit.term, { term: hit.term, hits: hit.hits })
  }
  const resolved = [...terms.values()]
  if (resolved.length > 0) {
    return {
      terms: resolved,
      oneLiner: reply.oneLiner.trim(),
      proposed: [...mapped.map((term) => term.term), ...reply.terms],
      sentences: []
    }
  }

  const sentences = evidenceSearch(ikb, conceptEvidenceQueries(ikb, concept), roles, 5)
  if (sentences.length === 0) {
    return {
      terms: [],
      oneLiner: reply.oneLiner.trim(),
      proposed: reply.terms,
      sentences: []
    }
  }

  const runtime = await llm.json(runtimeSkillOut, {
    lane: 'fast',
    ...nameRuntimeSkill(concept.name, concept.summary, sentences)
  })
  const byId = new Map(sentences.map((sentence) => [sentence.id, sentence]))
  const cited = [...new Set(runtime.citations)]
    .map((id) => byId.get(id))
    .filter((sentence): sentence is Sentence => sentence !== undefined)

  if (!runtime.skill.trim() || cited.length === 0) {
    return {
      terms: [],
      oneLiner: reply.oneLiner.trim(),
      proposed: [...reply.terms, runtime.skill],
      sentences: []
    }
  }

  return {
    terms: [{ term: runtime.skill.trim(), hits: cited.length }],
    oneLiner: runtime.oneLiner.trim(),
    proposed: [...reply.terms, runtime.skill],
    sentences: cited
  }
}
