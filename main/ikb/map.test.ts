import assert from 'node:assert/strict'
import { before, test } from 'node:test'
import { resolve } from 'node:path'
import type { Concept } from '../../shared/types.ts'
import { evidenceFor, evidenceOf } from './search.ts'
import { loadIkb, type Ikb } from './load.ts'
import { conceptEvidenceQueries, mapConceptTerms } from './map.ts'

let ikb: Ikb

before(async () => {
  ikb = await loadIkb(resolve(import.meta.dirname, '../../data'))
})

function concept(name: string, summary: string): Concept {
  return { name, summary, confidence: 'high' }
}

test('the taxonomy distinguishes tools from practices', () => {
  assert.equal(ikb.taxonomy.get('PostgreSQL')?.kind, 'tool')
  assert.equal(ikb.taxonomy.get('code review')?.kind, 'practice')
  assert.ok(ikb.tools.has('PostgreSQL'))
  assert.ok(ikb.practices.has('code review'))
})

test('academic phrasing maps deterministically to posting terms with hits', () => {
  const mapped = mapConceptTerms(
    ikb,
    concept('Amortized analysis', 'The cost of a resize gets spread over many cheap array operations.')
  )
  assert.deepEqual(
    mapped.map((hit) => hit.term).slice(0, 3),
    ['performance optimization', 'scalability', 'system design']
  )
  assert.ok(mapped.every((hit) => hit.hits > 0))
  assert.ok(mapped.every((hit) => hit.kind === 'practice'))
})

test('aliases and literal tool names normalize to the canonical vocabulary', () => {
  const mapped = mapConceptTerms(
    ikb,
    concept('Database indexes', 'Using Postgres query planning to make relational lookups fast.')
  )
  const terms = mapped.map((hit) => hit.term)
  assert.ok(terms.includes('PostgreSQL'))
  assert.ok(terms.includes('SQL'))
  assert.ok(terms.includes('performance optimization'))
})

test('unsupported concepts do not invent a mapping', () => {
  const mapped = mapConceptTerms(
    ikb,
    concept('lambda calculus church numerals', 'Pure symbolic encodings of natural numbers.')
  )
  assert.deepEqual(mapped, [])
})

test('leetCode-style concepts can expand to runtime evidence queries without becoming fixed tags', () => {
  const leetcode = concept(
    'monotonic stack',
    'A stack kept in sorted order while scanning an array for the next greater element.'
  )
  assert.deepEqual(mapConceptTerms(ikb, leetcode), [])
  assert.ok(conceptEvidenceQueries(ikb, leetcode).includes('data structures and algorithms'))
})

test('unsupported configured mappings are dropped before they can become evidence', () => {
  const partial = {
    vocabulary: new Map([
      ['code review', 'code review'],
      ['ghost skill', 'ghost skill']
    ]),
    byTag: new Map([['code review', [{ id: 's1', postingId: 'p1', text: 'Review code with teammates.', tags: ['code review'] }]]]),
    taxonomy: new Map([['code review', { term: 'code review', aliases: [], kind: 'practice' }]]),
    conceptMappings: [{ concept: 'review', aliases: [], terms: ['code review', 'ghost skill'] }]
  } as unknown as Ikb

  const mapped = mapConceptTerms(partial, concept('review', 'A class discussion of reviewing changes.'))
  assert.deepEqual(
    mapped.map((hit) => hit.term),
    ['code review']
  )
})

test('mapped terms still produce traceable posting evidence', () => {
  const mapped = mapConceptTerms(
    ikb,
    concept('REST APIs', 'HTTP methods, resources, routes, and status codes.')
  )
  const sentences = evidenceFor(ikb, mapped, ['backend'])
  assert.ok(sentences.length > 0)
  for (const sentence of sentences) {
    const evidence = evidenceOf(ikb, sentence)
    assert.ok(evidence)
    assert.equal(evidence.sentence.id, sentence.id)
    assert.ok(evidence.url.startsWith('http'))
    assert.ok(sentence.tags.some((tag) => mapped.some((hit) => hit.term === tag)))
  }
})
