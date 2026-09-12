import assert from 'node:assert/strict'
import { test } from 'node:test'
import { CitationFilter } from './citations.ts'

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
