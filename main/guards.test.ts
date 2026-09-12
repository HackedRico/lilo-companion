import assert from 'node:assert/strict'
import { test } from 'node:test'
import { asPoint, asText } from './guards.ts'

test('a real point comes through', () => {
  assert.deepEqual(asPoint({ x: 12, y: -4 }), { x: 12, y: -4 })
  assert.deepEqual(asPoint({ x: 0, y: 0 }), { x: 0, y: 0 })
})

test('everything that would make a window throw is refused', () => {
  for (const bad of [
    undefined,
    null,
    'nope',
    42,
    {},
    { x: 1 },
    { y: 1 },
    { x: NaN, y: 1 },
    { x: 1, y: Infinity },
    { x: '10', y: '10' },
    { x: null, y: null }
  ]) {
    assert.equal(asPoint(bad), null, `${JSON.stringify(bad)} is not a point`)
  }
})

test('text is text, and never unbounded', () => {
  assert.equal(asText('hello'), 'hello')
  assert.equal(asText(undefined), '')
  assert.equal(asText({ toString: () => 'sneaky' }), '')
  assert.equal(asText('x'.repeat(100), 10).length, 10)
})
