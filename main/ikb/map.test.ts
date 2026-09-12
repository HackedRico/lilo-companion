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
  // No rule claims it, so what is searched for is the concept as the lecturer
  // said it. Postings do not advertise for a monotonic stack, and saying so is
  // the honest answer.
  const queries = conceptEvidenceQueries(ikb, leetcode)
  assert.ok(queries.includes(leetcode.name))
  assert.ok(queries.includes(leetcode.summary))
})

test('unsupported configured mappings are dropped before they can become evidence', () => {
  const partial = {
    vocabulary: new Map([
      ['code review', 'code review'],
      ['ghost skill', 'ghost skill']
    ]),
    byTag: new Map([['code review', [{ id: 's1', postingId: 'p1', text: 'Review code with teammates.', tags: ['code review'] }]]]),
    postingsByTag: new Map([['code review', 1]]),
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

test('a concept said in the singular reaches a rule written in the plural', () => {
  const singular = mapConceptTerms(ikb, {
    name: 'Hash Table',
    summary: 'A structure that finds a value by its key in constant time on average.',
    confidence: 'high'
  })
  const plural = mapConceptTerms(ikb, {
    name: 'Hash tables',
    summary: 'A structure that finds a value by its key in constant time on average.',
    confidence: 'high'
  })
  assert.ok(singular.length > 0, 'the singular form is not a dead end')
  assert.deepEqual(
    singular.map((term) => term.term).sort(),
    plural.map((term) => term.term).sort(),
    'and reaches the same terms the plural does'
  )
})

test('an alias that is also an ordinary word is matched as written, not stemmed', () => {
  const flag = mapConceptTerms(ikb, {
    name: 'Loop invariants',
    summary: 'The lecturer will set a flag when the loop finishes, and the invariant still holds.',
    confidence: 'high'
  })
  assert.deepEqual(flag, [], 'setting a flag is not a lecture on hash tables')
})

test('every rule points at vocabulary the postings actually carry', () => {
  // Eight rules once named terms that were in no vocabulary file, so they were
  // dropped without a word and four rules resolved to nothing at all.
  for (const rule of ikb.conceptMappings) {
    const resolved = rule.terms.filter((term) => ikb.vocabulary.has(term.trim().toLowerCase()))
    assert.deepEqual(
      rule.terms.filter((term) => !ikb.vocabulary.has(term.trim().toLowerCase())),
      [],
      `${rule.concept} names a term that is in no vocabulary file`
    )
    assert.ok(resolved.length > 0, `${rule.concept} resolves to nothing`)
  }
})

test('a data structures lecture is not a lecture about Node.js', () => {
  // "node" was an alias of Node.js, and it is the commonest word in a lecture
  // on trees. What a posting means by Node is written Node.js or NodeJS.
  const trees = mapConceptTerms(
    ikb,
    concept('Binary search trees', 'Every node has at most two children, and the left node is smaller.')
  )
  assert.ok(!trees.some((hit) => hit.term === 'Node.js'))
  const runtime = mapConceptTerms(
    ikb,
    concept('Server side JavaScript', 'The team runs the API on NodeJS behind a load balancer.')
  )
  assert.ok(runtime.some((hit) => hit.term === 'Node.js'))
})

test('the count said out loud is postings, not sentences', () => {
  // One posting says the same thing several times; the line reads "N of the
  // postings", so counting sentences overstated it by up to five times.
  for (const [term, count] of ikb.postingsByTag) {
    const sentences = ikb.byTag.get(term) ?? []
    const postings = new Set(sentences.map((sentence) => sentence.postingId))
    assert.equal(count, postings.size)
    assert.ok(count <= sentences.length)
  }
})

test('the term said out loud is the one the lecture names, not one in passing', () => {
  // The order was whatever the alias list happened to be sorted by, so a
  // summary that mentions Python made a lecture on DataFrames a lecture on
  // Python, with 604 postings behind it and a quote listing four languages.
  const mapped = mapConceptTerms(
    ikb,
    concept('Pandas DataFrames', 'A Python library providing tabular data structures for data analysis.')
  )
  assert.equal(mapped[0]?.term, 'Pandas')
  assert.ok(mapped.some((hit) => hit.term === 'Python'))
})
