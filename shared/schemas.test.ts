import assert from 'node:assert/strict'
import { test } from 'node:test'
import { conceptsOut } from './schemas.ts'

test('a reply with nothing in it means nothing is being taught', () => {
  // The prompt asks for an empty list when a lecture teaches nothing, and a
  // model with nothing to say leaves the list out instead: a conference deck
  // came back as {} three replies in four. Reading that as a fault put zod's
  // own complaint on screen in front of a student who had just uploaded a file.
  assert.deepEqual(conceptsOut.parse({}), { concepts: [] })
  assert.deepEqual(conceptsOut.parse({ concepts: [] }), { concepts: [] })
})

test('a reply with concepts in it still has to be shaped like one', () => {
  const good = { concepts: [{ name: 'Hash tables', summary: 'A key maps to a bucket.', confidence: 'high' }] }
  assert.deepEqual(conceptsOut.parse(good), good)
  assert.throws(() => conceptsOut.parse({ concepts: [{ name: 'x', summary: 'too short a name', confidence: 'high' }] }))
  assert.throws(() => conceptsOut.parse({ concepts: [{ name: 'Hash tables', summary: 'fine', confidence: 'certain' }] }))
  assert.throws(() => conceptsOut.parse({ concepts: 'not a list' }))
})
