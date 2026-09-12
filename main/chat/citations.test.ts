import assert from 'node:assert/strict'
import { test } from 'node:test'
import { CitationFilter, expand } from './citations.ts'

function run(tokens: string[], valid: string[]): { text: string; citations: string[] } {
  const filter = new CitationFilter(new Set(valid))
  let text = ''
  for (const token of tokens) text += filter.push(token)
  text += filter.flush()
  return { text, citations: filter.citations }
}

test('a real citation becomes a chip and leaves the prose clean', () => {
  const { text, citations } = run(['Teams do this at work ', '[S:a#1]', ' every week.'], ['a#1'])
  assert.equal(text, 'Teams do this at work  every week.')
  assert.deepEqual(citations, ['a#1'])
})

test('a citation split across tokens still resolves', () => {
  const { text, citations } = run(['Hiring posts say so ', '[S', ':a', '#1', ']', ' often.'], ['a#1'])
  assert.equal(text, 'Hiring posts say so  often.')
  assert.deepEqual(citations, ['a#1'])
})

test('an id that was never retrieved is stripped and not cited', () => {
  const { text, citations } = run(['Real [S:a#1] and invented [S:made-up] here'], ['a#1'])
  assert.equal(text, 'Real  and invented  here')
  assert.deepEqual(citations, ['a#1'])
})

test('ordinary brackets survive untouched', () => {
  const { text, citations } = run(['Use an array [0] and a list [1, 2] here'], ['a#1'])
  assert.equal(text, 'Use an array [0] and a list [1, 2] here')
  assert.deepEqual(citations, [])
})

test('an unterminated bracket at the end is prose, not a lost token', () => {
  const { text } = run(['The formula is sigma over [n'], [])
  assert.equal(text, 'The formula is sigma over [n')
})

test('the same source cited twice is one chip', () => {
  const { citations } = run(['[S:a#1] and again [S:a#1]'], ['a#1'])
  assert.deepEqual(citations, ['a#1'])
})

test('one marker holding several ids credits each one it was given', () => {
  const { text, citations } = run(
    ['Rounds vary ', '[S:leetcode:591#0, S:leetcode:584#2, S:leetcode:000#9]', ' by role.'],
    ['leetcode:591#0', 'leetcode:584#2']
  )
  assert.equal(text, 'Rounds vary  by role.')
  assert.deepEqual(citations, ['leetcode:591#0', 'leetcode:584#2'])
})

test('a long compound marker is plumbing, not prose', () => {
  const long = `[S:${['a#0', 'b#1', 'c#2', 'd#3', 'e#4', 'f#5'].map((id) => `S:leetcode:123456789${id}`).join(', ')}]`
  const { text } = run(['Before ', long, ' after'], [])
  assert.ok(long.length > 120, 'longer than a marker used to be allowed to be')
  assert.equal(text, 'Before  after', 'the student never sees the markers')
})

test('a range is the sentences of one account written short', () => {
  assert.deepEqual(expand('leetcode:99#0-#2'), ['leetcode:99#0', 'leetcode:99#1', 'leetcode:99#2'])
  assert.deepEqual(expand('leetcode:99#1-3'), ['leetcode:99#1', 'leetcode:99#2', 'leetcode:99#3'])
  assert.deepEqual(expand('leetcode:99#0'), ['leetcode:99#0'], 'a plain id is left alone')
  assert.deepEqual(expand('leetcode:99#5-#0'), ['leetcode:99#5-#0'], 'backwards is not a range')
  assert.equal(expand('leetcode:99#0-#900').length, 12, 'a wave at a whole source is narrowed to the cap')
  assert.deepEqual(expand('leetcode:99#0-#900')[0], 'leetcode:99#0')
})

test('a range credits the sentences it named that were actually retrieved', () => {
  const { text, citations } = run(['They said so [S:leetcode:99#0-#5] plainly'], ['leetcode:99#0', 'leetcode:99#2'])
  assert.equal(text, 'They said so  plainly')
  assert.deepEqual(citations, ['leetcode:99#0', 'leetcode:99#2'], 'and nothing it did not')
})

test('prose in brackets is let go at once rather than held to the end', () => {
  const { text } = run(['An array [of integers] and [S:a#1] a citation'], ['a#1'])
  assert.equal(text, 'An array [of integers] and  a citation')
})

test('a range no retriever could have made is left alone rather than counted up to', () => {
  const started = Date.now()
  assert.deepEqual(expand('a#9007199254740993-#9007199254740993'), ['a#9007199254740993-#9007199254740993'])
  assert.ok(Date.now() - started < 500, 'and nothing spins')
})

test('a range wider than the cap still credits the ids it named', () => {
  const { citations } = run(['x [S:a#0-#40] y'], ['a#0', 'a#5', 'a#30'])
  assert.deepEqual(citations, ['a#0', 'a#5'], 'up to the cap, and no further')
})
