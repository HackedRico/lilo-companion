import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Hint } from '../../shared/leetcode.ts'
import { CLIMB_EVERY, gate, mentions, nextRung } from './ladder.ts'
import { EMPTY_WORK, type Work } from './state.ts'

const CODE = 'def twoSum(nums, target):\n    seen = {}\n    for i, n in enumerate(nums):\n        seen[n] = i\n    return []'

const working: Work = {
  ...EMPTY_WORK,
  problem: { slug: 'two-sum', title: 'Two Sum', difficulty: 'Easy', statement: '' },
  code: CODE,
  language: 'python',
  changedAt: 0,
  inFront: true
}

test('a volunteered hint waits for effort and climbs one rung at a time', () => {
  assert.equal(nextRung(3, null, working, 1000), null, 'not a minute in yet')
  assert.equal(nextRung(3, null, working, CLIMB_EVERY), 1, 'the first hint is a question')
  const first = { rung: 1 as const, at: CLIMB_EVERY, codeAt: 0 }
  assert.equal(nextRung(3, first, working, CLIMB_EVERY * 2), null, 'the code has not changed since')
  const edited = { ...working, changedAt: CLIMB_EVERY + 1 }
  assert.equal(nextRung(3, first, edited, CLIMB_EVERY * 2), null, 'a minute since the edit, not since the hint')
  assert.equal(nextRung(3, first, edited, CLIMB_EVERY * 2 + 2), 2, 'then one rung higher')
  const third = { rung: 3 as const, at: CLIMB_EVERY * 3, codeAt: CLIMB_EVERY + 1 }
  const again = { ...working, changedAt: CLIMB_EVERY * 3 + 1 }
  assert.equal(nextRung(3, third, again, CLIMB_EVERY * 5), 3, 'and never above the ceiling')
})

test('hands off volunteers nothing, whatever the effort', () => {
  assert.equal(nextRung(0, null, working, CLIMB_EVERY * 10), null)
})

test('nothing is volunteered into a run, an accepted answer, quiet, or an empty tab', () => {
  const late = CLIMB_EVERY * 2
  assert.equal(nextRung(3, null, { ...working, pending: true }, late), null)
  assert.equal(nextRung(3, null, { ...working, outcome: { verdict: 'accepted', detail: '' } }, late), null)
  assert.equal(nextRung(3, null, { ...working, quietUntil: late + 1 }, late), null)
  assert.equal(nextRung(3, null, { ...working, inFront: false }, late), null)
  assert.equal(nextRung(3, null, { ...working, problem: null }, late), null)
})

test('above the ceiling is never said', () => {
  const hint: Hint = { rung: 4, say: 'Build the map first, then look up target minus n.', lines: [4], names: ['seen'] }
  assert.deepEqual(gate(hint, 3, working), { ok: false, reason: 'too_high' })
  assert.deepEqual(gate(hint, 4, working), { ok: true })
})

test('a line or a name that is not in the code is never said', () => {
  const badLine: Hint = { rung: 3, say: 'Line 9 never runs.', lines: [9], names: [] }
  assert.deepEqual(gate(badLine, 3, working), { ok: false, reason: 'unverified' })
  const badName: Hint = { rung: 3, say: 'You never read from cache.', lines: [], names: ['cache'] }
  assert.deepEqual(gate(badName, 3, working), { ok: false, reason: 'unverified' })
  const real: Hint = { rung: 3, say: 'seen is filled but never read.', lines: [], names: ['seen'] }
  assert.deepEqual(gate(real, 3, working), { ok: true })
})

test('a claim about their code has to point at their code', () => {
  const vague: Hint = { rung: 3, say: 'Think about what you store versus what you look up.', lines: [], names: [] }
  assert.deepEqual(gate(vague, 3, working), { ok: false, reason: 'generic' })
  const question: Hint = { rung: 1, say: 'What would you need to have seen before n to answer at n?', lines: [], names: [] }
  assert.deepEqual(gate(question, 1, working), { ok: true })
  assert.deepEqual(gate({ ...question, say: '  ' }, 1, working), { ok: false, reason: 'empty' })
})

test('a name counts as a whole word only', () => {
  assert.ok(mentions(CODE, 'seen'))
  assert.ok(mentions(CODE, 'twoSum'))
  assert.ok(!mentions(CODE, 'see'))
  assert.ok(!mentions(CODE, 'num'))
  assert.ok(!mentions(CODE, ''))
})

test('the steps and the answer are new work, so they point at nothing of theirs', () => {
  const steps: Hint = { rung: 4, say: 'Walk the array once, storing each value against its index as you go.', lines: [], names: [] }
  assert.deepEqual(gate(steps, 4, working), { ok: true })
  const answer: Hint = { rung: 5, say: 'seen = {}\nfor i, n in enumerate(nums):\n    if target - n in seen:\n        return [seen[target - n], i]', lines: [], names: [] }
  assert.deepEqual(gate(answer, 5, working), { ok: true }, 'a tutor who may answer can hand over code')
  assert.deepEqual(gate(answer, 3, working), { ok: false, reason: 'too_high' }, 'and a coach still cannot')
})

test('a promise with nothing after it is refused rather than said', () => {
  const promise: Hint = { rung: 5, say: "Here's the working code for Two Sum:", lines: [], names: [] }
  assert.deepEqual(gate(promise, 5, working), { ok: false, reason: 'promise' })
  const kept: Hint = { rung: 5, say: "Here's the working code:\nseen = {}\nfor i, n in enumerate(nums): ...", lines: [], names: [] }
  assert.deepEqual(gate(kept, 5, working), { ok: true })
  const question: Hint = { rung: 1, say: 'What do you need to have seen before n:', lines: [], names: [] }
  assert.deepEqual(gate(question, 3, working), { ok: true }, 'a low rung is not a promise of anything')
})
