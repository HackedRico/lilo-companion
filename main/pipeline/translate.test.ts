import assert from 'node:assert/strict'
import { before, test } from 'node:test'
import { resolve } from 'node:path'
import type { ZodType } from 'zod'
import type { Concept } from '../../shared/types.ts'
import { loadIkb, type Ikb } from '../ikb/load.ts'
import type { Ask, LlmLike } from '../llm/service.ts'
import { translate } from './translate.ts'

/**
 * A model that proposes a term the vocabulary does not carry, and then names a
 * runtime skill. `skill` says what it names when the fixed vocabulary misses:
 * by default it echoes words out of the first quote it was shown, which is what
 * the prompt asks for.
 */
class TranslationLlm implements LlmLike {
  available = true
  readonly asks: Ask[] = []
  skill: string | null = null

  async json<T>(schema: ZodType<T>, ask: Ask): Promise<T> {
    this.asks.push(ask)
    if (ask.system.includes('did not resolve to the fixed skill vocabulary')) {
      const evidence = [...ask.user.matchAll(/\[S:([^\]]+)\] ([^\n]+)/g)]
      const ids = evidence.map((match) => match[1]!)
      const first = evidence[0]
      const echoed = first
        ? first[2]!
            .toLowerCase()
            .replace(/[^a-z0-9 ]+/g, ' ')
            .split(/\s+/)
            .sort((a, b) => b.length - a.length)
            .slice(0, 2)
            .join(' ')
        : 'nothing'
      return schema.parse({
        skill: this.skill ?? echoed,
        citations: [ids[0], 'made-up-id'].filter(Boolean),
        oneLiner: 'You meet this whenever teams expect clean fundamentals under messy production constraints.'
      }) as T
    }
    return schema.parse({
      terms: ['quantum teleportation'],
      oneLiner: 'You meet this whenever a service boundary has to make boring production sense.'
    }) as T
  }

  async text(): Promise<string> {
    throw new Error('not used')
  }

  async stream(): Promise<string> {
    throw new Error('not used')
  }
}

let ikb: Ikb

before(async () => {
  ikb = await loadIkb(resolve(import.meta.dirname, '../../data'))
})

function concept(name: string, summary: string): Concept {
  return { name, summary, confidence: 'high' }
}

test('deterministic mappings survive even when the model proposes unsupported terms', async () => {
  const llm = new TranslationLlm()
  const translated = await translate(
    llm,
    ikb,
    concept('REST APIs', 'HTTP methods, resources, routes, and status codes.')
  )

  const terms = translated.terms.map((hit) => hit.term)
  assert.ok(terms.includes('REST'))
  assert.ok(terms.includes('API design'))
  assert.ok(!terms.includes('quantum teleportation'))
  assert.ok(translated.terms.every((hit) => hit.hits > 0))
})

test('the model menu is seeded with explicit mappings from the evidence base', async () => {
  const llm = new TranslationLlm()
  await translate(
    llm,
    ikb,
    concept('database normalization', 'Normal forms organize relational tables.')
  )

  const ask = llm.asks[0]
  assert.ok(ask)
  assert.match(ask.user, /SQL/)
  assert.match(ask.user, /PostgreSQL/)
  assert.match(ask.user, /system design/)
})

test('when fixed vocabulary misses, a skill the quotes say is allowed through', async () => {
  const llm = new TranslationLlm()
  const translated = await translate(
    llm,
    ikb,
    concept('sliding window', 'A LeetCode array technique for keeping a moving range of values.'),
    ['swe']
  )

  const [term] = translated.terms
  assert.ok(term)
  assert.equal(translated.sentences.length, 1)
  // The term never passed through the vocabulary, so the quote has to say it.
  const said = translated.sentences[0]!.text.toLowerCase()
  assert.ok(term.term.split(' ').every((word) => said.includes(word)))
  assert.ok(!translated.sentences.some((sentence) => sentence.id === 'made-up-id'))
})

test('a skill the quotes do not say is refused rather than said out loud', async () => {
  // Nothing above this checked the runtime skill against anything, so the model
  // could name a phrase no posting uses and the companion would read it out as
  // what industry calls the concept.
  const llm = new TranslationLlm()
  llm.skill = 'Chief Happiness Officer'
  const translated = await translate(
    llm,
    ikb,
    concept('sliding window', 'A LeetCode array technique for keeping a moving range of values.'),
    ['swe']
  )

  assert.deepEqual(translated.terms, [])
  assert.deepEqual(translated.sentences, [])
})
