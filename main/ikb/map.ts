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

function pushSupported(
  ikb: Ikb,
  out: Map<string, MappedTerm>,
  raw: string,
  source: MappingSource
): void {
  const canonical = ikb.vocabulary.get(raw.trim().toLowerCase())
  if (!canonical || out.has(canonical)) return
  const hits = ikb.byTag.get(canonical)?.length ?? 0
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
    const triggers = [rule.concept, ...rule.aliases].map(normalise).filter(Boolean)
    if (triggers.some((trigger) => includesPhrase(text, trigger))) {
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
    const triggers = [rule.concept, ...rule.aliases].map(normalise).filter(Boolean)
    if (triggers.some((trigger) => includesPhrase(text, trigger))) {
      queries.push(...rule.terms)
    }
  }
  queries.push(concept.name, concept.summary)
  return [...new Set(queries.map((query) => query.trim()).filter((query) => query.length >= MIN_LITERAL))]
}
