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

function flatten(input: string): string {
  return input.toLowerCase().replace(/[^a-z0-9+#.]+/g, ' ').replace(/\s+/g, ' ').trim()
}

/** Joining words carry no meaning here, so they are not asked to prove anything. */
const JOINING = new Set(['and', 'the', 'for', 'with', 'from', 'into', 'that', 'this', 'its', 'of', 'in', 'on', 'to', 'a', 'an'])

function stem(word: string): string {
  return word.length > 3 && word.endsWith('s') && !/(ss|is|us)$/.test(word) ? word.slice(0, -1) : word
}

/**
 * Whether the quotes the model cited actually say the skill it named. Every
 * word that carries meaning has to turn up somewhere in them, so a phrase the
 * postings never use cannot be passed off as what they call the concept.
 */
function vouchedFor(sentences: Sentence[], skill: string): boolean {
  const words = flatten(skill).split(' ').filter((word) => word.length > 2 && !JOINING.has(word))
  if (words.length === 0) return false
  const said = new Set(sentences.flatMap((sentence) => flatten(sentence.text).split(' ')).map(stem))
  return words.every((word) => said.has(stem(word)))
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

  // This is the one term that never passed through the vocabulary, so the
  // postings have to vouch for it here instead: the words have to be in a
  // quote the model itself cited. Without this the model can name anything it
  // likes and the companion says it as though a posting had.
  const saidInPostings = vouchedFor(cited, runtime.skill)

  if (!runtime.skill.trim() || cited.length === 0 || !saidInPostings) {
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
