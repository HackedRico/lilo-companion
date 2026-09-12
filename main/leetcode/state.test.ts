import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { WorkEvent } from '../../shared/leetcode.ts'
import { EMPTY_WORK, QUIET_MS, ago, describe, fold } from './state.ts'

const PROBLEM = { slug: 'two-sum', title: 'Two Sum', difficulty: 'Easy', statement: 'Find two numbers that add up.' }

function run(events: WorkEvent[]) {
  return events.reduce(fold, EMPTY_WORK)
}

test('the state reads back in words that need no model', () => {
  const now = 100000
  const work = run([
    { kind: 'opened', at: 0, problem: PROBLEM },
    { kind: 'changed', at: now - 40000, code: 'def twoSum(nums, target):\n    seen = {}\n    return []', language: 'python' },
    { kind: 'outcome', at: now - 5000, outcome: { verdict: 'wrong_answer', detail: '', input: '[3,3]', expected: '[0,1]', output: '[]' } }
  ])
  assert.equal(
    describe(work, now),
    'Two Sum, easy. 3 lines of python, last changed 40 seconds ago. The last run came back wrong answer: input [3,3], expected [0,1], got [].'
  )
})

test('nothing open is said plainly', () => {
  assert.equal(describe(EMPTY_WORK, 0), 'Nothing open on LeetCode.')
  const opened = run([{ kind: 'opened', at: 0, problem: PROBLEM }])
  assert.equal(describe(opened, 0), 'Two Sum, easy. Nothing written yet.')
})

test('a run in flight makes the verdict on file stale', () => {
  const work = run([
    { kind: 'opened', at: 0, problem: PROBLEM },
    { kind: 'changed', at: 1, code: 'x', language: 'python' },
    { kind: 'outcome', at: 2, outcome: { verdict: 'accepted', detail: '' } },
    { kind: 'pending', at: 3 }
  ])
  assert.ok(work.pending)
  assert.match(describe(work, 3), /A run is in flight\.$/)
  const done = fold(work, { kind: 'outcome', at: 4, outcome: { verdict: 'time_limit', detail: '' } })
  assert.ok(!done.pending)
  assert.equal(done.attempts, 2)
})

test('the same code again is not a change', () => {
  const work = run([
    { kind: 'opened', at: 0, problem: PROBLEM },
    { kind: 'changed', at: 10, code: 'x', language: 'python' }
  ])
  assert.equal(fold(work, { kind: 'changed', at: 20, code: 'x', language: 'python' }).changedAt, 10)
  assert.equal(fold(work, { kind: 'changed', at: 20, code: 'xy', language: 'python' }).changedAt, 20)
})

test('opening a new problem keeps only what the student chose', () => {
  const work = run([
    { kind: 'ceiling', at: 0, tier: 'tutor' },
    { kind: 'quiet', at: 5 },
    { kind: 'opened', at: 10, problem: PROBLEM },
    { kind: 'changed', at: 11, code: 'x', language: 'python' },
    { kind: 'opened', at: 20, problem: { ...PROBLEM, slug: 'add-two-numbers', title: 'Add Two Numbers' } }
  ])
  assert.equal(work.tier, 'tutor')
  assert.equal(work.quietUntil, 5 + QUIET_MS)
  assert.equal(work.code, '')
  assert.equal(work.problem?.title, 'Add Two Numbers')
})

test('time reads the way a person would say it', () => {
  assert.equal(ago(1000, 5000), 'just now')
  assert.equal(ago(0, 40000), '40 seconds ago')
  assert.equal(ago(0, 60000 * 3), '3 minutes ago')
  assert.equal(ago(0, 60000), '1 minute ago')
})
