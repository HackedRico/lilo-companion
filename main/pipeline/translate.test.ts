import assert from 'node:assert/strict'
import { before, test } from 'node:test'
import { resolve } from 'node:path'
import type { ZodType } from 'zod'
import type { Concept } from '../../shared/types.ts'
import { loadIkb, type Ikb } from '../ikb/load.ts'
import type { Ask, LlmLike } from '../llm/service.ts'
import { translate } from './translate.ts'

class TranslationLlm implements LlmLike {
  available = true
  readonly asks: Ask[] = []

  async json<T>(schema: ZodType<T>, ask: Ask): Promise<T> {
    this.asks.push(ask)
    if (ask.system.includes('did not resolve to the fixed skill vocabulary')) {
      const evidence = [...ask.user.matchAll(/\[S:([^\]]+)\] ([^\n]+)/g)]
      const ids = evidence.map((match) => match[1]!)
      const dsa = evidence.find((match) => /data structures|algorithms/i.test(match[2]!))?.[1]
      return schema.parse({
        skill: 'data structures and algorithms',
        citations: [dsa ?? ids[0], 'made-up-id'].filter(Boolean),
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

test('when fixed vocabulary misses, runtime evidence can name a supported skill', async () => {
  const llm = new TranslationLlm()
  const translated = await translate(
    llm,
    ikb,
    concept('sliding window', 'A LeetCode array technique for keeping a moving range of values.'),
    ['swe']
  )

  assert.deepEqual(translated.terms, [{ term: 'data structures and algorithms', hits: 1 }])
  assert.equal(translated.sentences.length, 1)
  assert.ok(translated.sentences[0]!.text.length > 0)
  assert.ok(
    translated.sentences[0]!.text.toLowerCase().includes('data structures') ||
      translated.sentences[0]!.text.toLowerCase().includes('algorithms')
  )
  assert.ok(!translated.sentences.some((sentence) => sentence.id === 'made-up-id'))
})
