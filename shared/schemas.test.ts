import assert from 'node:assert/strict'
import { test } from 'node:test'
import { conceptsOut, traceOut } from './schemas.ts'

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

test('a dry run cell that holds a list is read as one, not thrown away', () => {
  // The prompt asks for a cell bare, "17" or "[2, 7]", and a model handed a
  // cell holding a list writes it as a list. That threw the whole picture away
  // and the words with it, so the student got an apology instead of a hint.
  const drawn = traceOut.parse({
    input: 'nums = [1, 2, 3, 1]',
    items: ['1', '2', '3', '1'],
    columns: ['seen'],
    steps: [
      { values: [['2', '7']], marks: [{ at: 0, label: 'i' }], note: 'both are in seen now', line: 4 },
      { values: [17], marks: [], note: 'the count so far' }
    ]
  })
  assert.equal(drawn.steps[0]?.values[0], '[2, 7]')
  assert.equal(drawn.steps[1]?.values[0], '17')
})
