import assert from 'node:assert/strict'
import { before, test } from 'node:test'
import { resolve } from 'node:path'
import { loadIkb, type Ikb } from './load.ts'
import { familiesOf, resolveAim, resolveAims } from './roles.ts'

let ikb: Ikb

before(async () => {
  ikb = await loadIkb(resolve(import.meta.dirname, '../../data'))
})

test('the obvious phrasings land where you would expect', () => {
  assert.equal(resolveAim(ikb, 'software engineering').family, 'swe')
  assert.equal(resolveAim(ikb, 'backend engineer').family, 'swe')
  assert.equal(resolveAim(ikb, 'data science').family, 'data')
  assert.equal(resolveAim(ikb, 'product manager').family, 'pm')
  assert.equal(resolveAim(ikb, 'security').family, 'security')
})

test('a phrase nobody hires for admits it rather than guessing', () => {
  const aim = resolveAim(ikb, 'underwater basket weaving')
  assert.equal(aim.family, null)
  assert.equal(aim.said, 'underwater basket weaving')
})

test('an empty or one letter phrase resolves to nothing', () => {
  assert.equal(resolveAim(ikb, '').family, null)
  assert.equal(resolveAim(ikb, ' x ').family, null)
})

test('only what resolved becomes a filter, in the order it was said', () => {
  const aims = resolveAims(ikb, ['product manager', 'underwater basket weaving', 'data science'])
  assert.deepEqual(familiesOf(aims), ['pm', 'data'])
})

test('the same family said twice is one filter', () => {
  assert.deepEqual(familiesOf(resolveAims(ikb, ['backend engineer', 'software engineering'])), ['swe'])
})
