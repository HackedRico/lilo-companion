import assert from 'node:assert/strict'
import { before, test } from 'node:test'
import { resolve } from 'node:path'
import { loadIkb, type Ikb } from './load.ts'
import { evidenceFor, evidenceOf, freeSearch, resolveTerms } from './search.ts'
import { computeGaps } from './gaps.ts'

let ikb: Ikb

before(async () => {
  ikb = await loadIkb(resolve(import.meta.dirname, '../../data'))
})

test('the anchor terms return real sentences', () => {
  for (const term of ['A/B testing', 'code review']) {
    const hits = ikb.byTag.get(term) ?? []
    assert.ok(hits.length > 10, `${term} has ${hits.length} sentences`)
    assert.ok(ikb.postings.has(hits[0]!.postingId), 'every sentence traces to a posting')
  }
})

test('loose phrasing resolves to the tagged vocabulary, and invented terms do not', () => {
  const resolved = resolveTerms(ikb, ['split testing', 'Postgres', 'quantum teleportation'])
  const terms = resolved.map((hit) => hit.term)
  assert.ok(terms.includes('A/B testing'))
  assert.ok(terms.includes('PostgreSQL'))
  assert.ok(!terms.includes('quantum teleportation'))
  assert.ok(resolved.every((hit) => hit.hits > 0), 'a term with no hits never survives')
})

test('a card quotes three companies, not one company three times', () => {
  const terms = resolveTerms(ikb, ['A/B testing', 'experimentation'])
  const sentences = evidenceFor(ikb, terms, ['data'])
  assert.equal(sentences.length, 3)
  const companies = sentences.map((s) => ikb.postings.get(s.postingId)?.company)
  assert.equal(new Set(companies).size, 3)
  for (const sentence of sentences) {
    const evidence = evidenceOf(ikb, sentence)
    assert.ok(evidence?.url.startsWith('http'), 'evidence links back to the posting')
  }
})

test('free text search finds sentences for a question', () => {
  const found = freeSearch(ikb, 'how do teams deploy code safely', 4)
  assert.ok(found.length > 0)
  assert.ok(found.every((sentence) => sentence.text.length > 0))
})

test('three real gaps come back for a software role', () => {
  const { gaps, cohort } = computeGaps(ikb, ['swe'], [])
  assert.equal(gaps.length, 3)
  for (const gap of gaps) {
    assert.ok(ikb.practices.has(gap.practice), `${gap.practice} is a practice, not a tool`)
    assert.ok(gap.pctOfPostings > 0 && gap.pctOfPostings <= 100)
    assert.ok(gap.exampleSentence.text.length > 0)
    assert.ok(gap.exampleSentence.tags.includes(gap.practice))
  }
  assert.ok(cohort.postings >= 40, 'percentages are taken over a real cohort')
})

test('what the student already heard is not sold back to them as a gap', () => {
  const { gaps } = computeGaps(ikb, ['swe'], [])
  const top = gaps[0]!.practice
  const after = computeGaps(ikb, ['swe'], [top])
  assert.ok(!after.gaps.some((gap) => gap.practice === top))
})
