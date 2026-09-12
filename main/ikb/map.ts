import type { Concept } from '../../shared/types.ts'
import type { Ikb } from './load.ts'
import type { Term } from './tag.ts'

export type TermKind = 'tool' | 'practice'
export type MappingSource = 'literal' | 'explicit'

export interface TaxonomyEntry extends Term {
  kind: TermKind
}

export interface ConceptMapRule {
  concept: string
  aliases: string[]
  terms: string[]
}

export interface MappedTerm {
  term: string
  hits: number
  kind: TermKind
  source: MappingSource
}

const MIN_LITERAL = 3

function normalise(input: string): string {
  return input
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[^a-z0-9+#./]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function includesPhrase(haystack: string, needle: string): boolean {
  return haystack === needle || haystack.startsWith(`${needle} `) || haystack.endsWith(` ${needle}`) || haystack.includes(` ${needle} `)
}

/**
 * A lecturer says "hash table" and the rule is written "hash tables". Dropping
 * a plural s off both sides is the whole of what is needed, and it is the same
 * move `watch.ts` makes for the same reason. "ss", "is" and "us" are left
 * alone, so "class" and "analysis" survive.
 */
function singular(word: string): string {
  if (word.length > 3 && word.endsWith('s') && !/(ss|is|us)$/.test(word)) return word.slice(0, -1)
  return word
}

/**
 * Only a phrase is stemmed. A one word trigger is matched as written, because
 * "sets" and "pointers" are aliases of real concepts and also ordinary words:
 * stemming them makes "set a flag when the loop finishes" a lecture on hash tables.
 */
function stemPhrase(input: string): string {
  const words = normalise(input).split(' ')
  return words.length > 1 ? words.map(singular).join(' ') : words.join(' ')
}

/** Whether the concept text reaches any of a rule's trigger phrases. */
function triggered(text: string, rule: ConceptMapRule): boolean {
  const plain = normalise(text)
  const stemmed = stemPhrase(text)
  return [rule.concept, ...rule.aliases].filter(Boolean).some((raw) => {
    const trigger = stemPhrase(raw)
    return normalise(raw).split(' ').length > 1
      ? includesPhrase(stemmed, trigger)
      : includesPhrase(plain, normalise(raw))
  })
}

function pushSupported(
  ikb: Ikb,
  out: Map<string, MappedTerm>,
  raw: string,
  source: MappingSource
): void {
  const canonical = ikb.vocabulary.get(raw.trim().toLowerCase())
  if (!canonical || out.has(canonical)) return
  const hits = ikb.postingsByTag.get(canonical) ?? 0
  const kind = ikb.taxonomy.get(canonical)?.kind
  if (hits > 0 && kind) out.set(canonical, { term: canonical, hits, kind, source })
}

export function buildTaxonomy(tools: Term[], practices: Term[]): Map<string, TaxonomyEntry> {
  const taxonomy = new Map<string, TaxonomyEntry>()
  for (const term of tools) taxonomy.set(term.term, { ...term, kind: 'tool' })
  for (const term of practices) taxonomy.set(term.term, { ...term, kind: 'practice' })
  return taxonomy
}

/**
 * Deterministic concept mapping catches classroom words that postings rarely
 * say directly. The resolved terms still have to exist in the vocabulary and
 * carry real posting hits before they can be shown.
 */
export function mapConceptTerms(ikb: Ikb, concept: Concept): MappedTerm[] {
  const text = normalise(`${concept.name} ${concept.summary}`)
  const out = new Map<string, MappedTerm>()

  for (const rule of ikb.conceptMappings) {
    if (triggered(text, rule)) {
      for (const term of rule.terms) pushSupported(ikb, out, term, 'explicit')
    }
  }

  const literal = [...ikb.vocabulary.entries()]
    .filter(([alias]) => normalise(alias).length >= MIN_LITERAL)
    .sort((a, b) => b[0].length - a[0].length)

  for (const [alias, canonical] of literal) {
    if (!includesPhrase(text, normalise(alias))) continue
    pushSupported(ikb, out, canonical, 'literal')
  }

  return [...out.values()]
}

export function conceptEvidenceQueries(ikb: Ikb, concept: Concept): string[] {
  const text = normalise(`${concept.name} ${concept.summary}`)
  const queries: string[] = []
  for (const rule of ikb.conceptMappings) {
    if (triggered(text, rule)) queries.push(...rule.terms)
  }
  queries.push(concept.name, concept.summary)
  return [...new Set(queries.map((query) => query.trim()).filter((query) => query.length >= MIN_LITERAL))]
}
