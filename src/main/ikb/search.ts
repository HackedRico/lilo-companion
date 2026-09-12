import type { Card, Evidence, Profile, RoleFamily, Sentence } from '../../shared/types.ts'
import type { Ikb } from './load.ts'

/** How many sentences a card carries. */
const EVIDENCE = 3

export interface TermHit {
  term: string
  hits: number
}

/**
 * The model gives loose phrases. Only what resolves to the tagged vocabulary
 * counts, so a card can never claim a term the postings do not carry.
 */
export function resolveTerms(ikb: Ikb, raw: string[]): TermHit[] {
  const seen = new Map<string, number>()
  for (const phrase of raw) {
    const canonical = ikb.vocabulary.get(phrase.trim().toLowerCase())
    if (!canonical) continue
    const hits = ikb.byTag.get(canonical)?.length ?? 0
    if (hits > 0) seen.set(canonical, hits)
  }
  // Kept in the order the model offered them: it is ranking by how well the
  // term fits, and hit count only says which are common, not which are apt.
  return [...seen.entries()].map(([term, hits]) => ({ term, hits }))
}

function scoreFor(sentence: Sentence, roles: Set<RoleFamily>, ikb: Ikb, headline?: string): number {
  const posting = ikb.postings.get(sentence.postingId)
  if (!posting) return -1
  let score = 0
  // The quote has to back the term the companion just said out loud.
  if (headline && sentence.tags.includes(headline)) score += 14
  if (roles.has(posting.roleFamily)) score += 10
  if (posting.seniority === 'intern' || posting.seniority === 'new_grad') score += 4
  if (posting.seniority === 'junior') score += 2
  // Shorter sentences quote better.
  score += Math.max(0, 6 - Math.floor(sentence.text.length / 60))
  return score
}

/** Sentences for a card: on-role where possible, and never two from one company. */
export function evidenceFor(ikb: Ikb, terms: TermHit[], roles: RoleFamily[]): Sentence[] {
  const wanted = new Set(roles.length > 0 ? roles : (['swe'] as RoleFamily[]))
  const pool = new Map<string, Sentence>()
  for (const { term } of terms) {
    for (const sentence of ikb.byTag.get(term) ?? []) pool.set(sentence.id, sentence)
  }

  const headline = terms[0]?.term
  const ranked = [...pool.values()]
    .map((sentence) => ({ sentence, score: scoreFor(sentence, wanted, ikb, headline) }))
    .filter((entry) => entry.score >= 0)
    .sort((a, b) => b.score - a.score)

  const picked: Sentence[] = []
  const companies = new Set<string>()
  for (const { sentence } of ranked) {
    const company = ikb.postings.get(sentence.postingId)?.company
    if (!company || companies.has(company)) continue
    companies.add(company)
    picked.push(sentence)
    if (picked.length === EVIDENCE) break
  }
  return picked
}

export function evidenceOf(ikb: Ikb, sentence: Sentence): Evidence | undefined {
  const posting = ikb.postings.get(sentence.postingId)
  if (!posting) return undefined
  return { sentence, company: posting.company, title: posting.title, url: posting.url }
}

/** Free text retrieval, for companion chat rather than for cards. */
export function freeSearch(ikb: Ikb, query: string, limit = 5): Sentence[] {
  const results = ikb.search.search(query, { combineWith: 'OR' }).slice(0, limit * 3)
  const picked: Sentence[] = []
  const companies = new Set<string>()
  for (const result of results) {
    const sentence = ikb.sentences.find((candidate) => candidate.id === result.id)
    if (!sentence) continue
    const company = ikb.postings.get(sentence.postingId)?.company
    if (!company || companies.has(company)) continue
    companies.add(company)
    picked.push(sentence)
    if (picked.length === limit) break
  }
  return picked
}

/**
 * The terms that live near a piece of text, ranked by how often they turn up in
 * the sentences that match it. Narrowing the menu this way is what stops the
 * model handing the academic name straight back.
 */
export function nearbyTerms(ikb: Ikb, query: string, limit = 24): string[] {
  const counts = new Map<string, number>()
  for (const result of ikb.search.search(query, { combineWith: 'OR' }).slice(0, 200)) {
    for (const tag of (result['tags'] as string[] | undefined) ?? []) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1)
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([term]) => term)
}

export function cardFrom(
  concept: Card['concept'],
  terms: TermHit[],
  sentences: Sentence[],
  oneLiner: string
): Card {
  return { id: `card_${Date.now().toString(36)}`, concept, terms, sentences, oneLiner }
}

export function profileRoles(profile: Profile): RoleFamily[] {
  const ranked = Object.entries(profile.roleAffinity)
    .sort((a, b) => b[1] - a[1])
    .map(([role]) => role as RoleFamily)
  return [...new Set([...profile.targetRoles, ...ranked])].slice(0, 2)
}
