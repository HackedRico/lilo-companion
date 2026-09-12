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
  assert.equal(resolveAim(ikb, 'backend engineer').family, 'backend')
  assert.equal(resolveAim(ikb, 'iOS').family, 'mobile')
  assert.equal(resolveAim(ikb, 'machine learning').family, 'ml')
  assert.equal(resolveAim(ikb, 'security').family, 'security')
  assert.equal(resolveAim(ikb, 'site reliability').family, 'infra')
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
  const aims = resolveAims(ikb, ['machine learning', 'underwater basket weaving', 'backend engineer'])
  assert.deepEqual(familiesOf(aims), ['ml', 'backend'])
})

test('the same track said twice is one filter', () => {
  assert.deepEqual(familiesOf(resolveAims(ikb, ['iOS engineer', 'android'])), ['mobile'])
})
