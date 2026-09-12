import assert from 'node:assert/strict'
import { test } from 'node:test'
import { TIER_CEILING, type Hint, type Trace } from '../../shared/leetcode.ts'
import { CLIMB_EVERY, gate, handsOverCode, mentions, namesFromCode, nextRung, reachedRung } from './ladder.ts'
import { EMPTY_WORK, PENDING_STALE_MS, type Work } from './state.ts'

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
  assert.equal(nextRung(3, null, { ...working, pendingAt: late }, late), null)
  assert.equal(nextRung(3, null, { ...working, outcome: { verdict: 'accepted', detail: '' } }, late), null)
  assert.equal(nextRung(3, null, { ...working, quietUntil: late + 1 }, late), null)
  assert.equal(nextRung(3, null, { ...working, inFront: false }, late), null)
  assert.equal(nextRung(3, null, { ...working, problem: null }, late), null)
})

test('a run whose verdict never came stops holding the companion quiet', () => {
  const submitted = { ...working, pendingAt: CLIMB_EVERY * 2 }
  assert.equal(nextRung(3, null, submitted, CLIMB_EVERY * 2), null, 'while the judge is still out')
  assert.equal(nextRung(3, null, submitted, CLIMB_EVERY * 2 + PENDING_STALE_MS), 1, 'and speaks again once it plainly is not coming')
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

test('the whole solution is never volunteered, however the code is written', () => {
  const answer: Hint = { rung: 4, say: 'Try this:\nseen = {}\nfor i, n in enumerate(nums):\n    return [seen[target - n], i]', lines: [], names: [] }
  assert.deepEqual(gate(answer, TIER_CEILING.tutor.volunteer, working), { ok: false, reason: 'too_high' }, 'nobody asked for it')
  assert.deepEqual(gate(answer, TIER_CEILING.tutor.onAsk, working), { ok: true }, 'and asked outright it is theirs')
  // The same answer with the newlines taken out is the same answer.
  const oneLine: Hint = { rung: 1, say: 'What if you wrote d = {}; for i, n in enumerate(nums): d[target - n] = i?', lines: [], names: [] }
  assert.deepEqual(gate(oneLine, TIER_CEILING.hands_off.onAsk, working), { ok: false, reason: 'too_high' })
  assert.deepEqual(gate(oneLine, TIER_CEILING.coach.onAsk, working), { ok: false, reason: 'too_high' })
})

test('a promise with nothing after it is refused rather than said', () => {
  const promise: Hint = { rung: 5, say: "Here's the working code for Two Sum:", lines: [], names: [] }
  assert.deepEqual(gate(promise, 5, working), { ok: false, reason: 'promise' })
  const kept: Hint = { rung: 5, say: "Here's the working code:\nseen = {}\nfor i, n in enumerate(nums): ...", lines: [], names: [] }
  assert.deepEqual(gate(kept, 5, working), { ok: true })
  const naming: Hint = { rung: 2, say: 'The idea here has a name: the one pass with a map.', lines: [], names: [] }
  assert.deepEqual(gate(naming, 3, working), { ok: true }, 'a low rung promises nothing, colon or not')
})

test('a statement about their code cannot arrive labelled as a question', () => {
  const mislabelled: Hint = {
    rung: 1,
    say: "Your code counts brackets but never checks that they match in order.",
    lines: [],
    names: []
  }
  assert.deepEqual(gate(mislabelled, 2, working), { ok: false, reason: 'not_a_question' })
  const asked: Hint = { ...mislabelled, say: 'What would tell you the brackets closed in the right order?' }
  assert.deepEqual(gate(asked, 2, working), { ok: true })
  const owned: Hint = { ...mislabelled, rung: 3, names: ['seen'] }
  assert.deepEqual(gate(owned, 2, working), { ok: false, reason: 'too_high' }, 'reported honestly, the ceiling catches it')
})

test('a verdict with a question tagged on the end is not a question', () => {
  const tagged: Hint = { rung: 1, say: 'Your loop never resets count after each window. See it?', lines: [], names: [] }
  assert.deepEqual(gate(tagged, 1, working), { ok: false, reason: 'not_a_question' })
  const real: Hint = { rung: 1, say: 'What resets count between windows?', lines: [], names: [] }
  assert.deepEqual(gate(real, 1, working), { ok: true })
  const quoted: Hint = { rung: 1, say: 'So what happens at the end of a window?"', lines: [], names: [] }
  assert.deepEqual(gate(quoted, 1, working), { ok: true }, 'a closing quote is still the end of a question')
})

test('what a hint actually says is what the ceiling answers to, not what it calls itself', () => {
  // Code handed over is the top of the ladder however it is labelled.
  const smuggled: Hint = {
    rung: 2,
    say: 'The idea is one pass with a map:\n```python\nseen = {}\nfor i, n in enumerate(nums):\n    return [seen[n], i]\n```',
    lines: [],
    names: []
  }
  assert.deepEqual(gate(smuggled, 2, working), { ok: false, reason: 'too_high' })
  assert.deepEqual(gate(smuggled, 5, working), { ok: true }, 'and a tutor may still have it')

  // A claim naming something out of their own code is a claim about their code.
  const aboutTheirCode: Hint = { rung: 2, say: 'Notice that `seen` is filled and never read.', lines: [], names: [] }
  assert.deepEqual(gate(aboutTheirCode, 2, working), { ok: false, reason: 'too_high' })
  assert.deepEqual(gate(aboutTheirCode, 3, working), { ok: true })

  // Prose about the idea, naming nothing of theirs, is left where the model put it.
  const idea: Hint = { rung: 2, say: 'This one has a name: the single pass with a lookup table.', lines: [], names: [] }
  assert.deepEqual(gate(idea, 2, working), { ok: true })
})

test('reading a hint back', () => {
  assert.ok(handsOverCode('```python\nx = 1\n```'))
  assert.ok(handsOverCode('Try this:\nseen = {}\nfor i, n in enumerate(nums):'))
  assert.ok(
    handsOverCode('What if you wrote d = {}; for i, n in enumerate(nums): d[target - n] = i and then returned [d[n], i]?'),
    'a solution written on one line is still a solution'
  )
  assert.ok(!handsOverCode('Walk the array once, storing each value against its index as you go.'))
  assert.ok(!handsOverCode('One line: think about what you store.'))
  assert.ok(!handsOverCode('What if you kept what you have already seen, and looked in it before storing n?'))
  assert.equal(reachedRung({ rung: 2, say: '```python\nseen = {}\n```', lines: [], names: [] }, working), 5, 'code is the top rung')
  assert.deepEqual(namesFromCode('Notice that `seen` is filled but never read.', CODE), ['seen'])
  assert.deepEqual(namesFromCode('Your twoSum loop is off by one.', CODE), ['twoSum'])
  assert.deepEqual(namesFromCode('The loop never resets the count.', CODE), [], 'ordinary words are prose')
  assert.equal(reachedRung({ rung: 0, say: 'Nested loops over the list.', lines: [], names: [] }, working), 1)
})

/** Two pointers walking in from the ends of a sorted array, on an example of the coach's own. */
const WALK: Trace = {
  input: 'a sorted array [1, 3, 5, 7], looking for a pair that makes 6',
  items: ['1', '3', '5', '7'],
  columns: ['sum'],
  steps: [
    { values: ['8'], marks: [{ at: 0, label: 'L' }, { at: 3, label: 'R' }], note: '1 and 7 make 8, over 6, so R steps in' },
    { values: ['6'], marks: [{ at: 0, label: 'L' }, { at: 2, label: 'R' }], note: '1 and 5 make 6, which is the pair' }
  ]
}

test('a dry run of the idea on its own example is rung 2, and one on their names is rung 3', () => {
  const idea: Hint = { rung: 2, say: 'Two pointers, one at each end, walking in.', lines: [], names: [], trace: WALK }
  assert.deepEqual(gate(idea, 2, working), { ok: true })
  assert.deepEqual(gate(idea, 1, working), { ok: false, reason: 'too_high' }, 'a picture of the idea is never a question')

  const theirs: Hint = { ...idea, trace: { ...WALK, columns: ['seen'] } }
  assert.deepEqual(gate(theirs, 2, working), { ok: false, reason: 'too_high' }, 'tracking their variable is a claim about their code')
  assert.deepEqual(gate({ ...theirs, rung: 3 }, 3, working), { ok: true })

  const onTheirLine: Hint = { ...idea, trace: { ...WALK, steps: [{ ...WALK.steps[0]!, line: 4 }] } }
  assert.deepEqual(gate(onTheirLine, 2, working), { ok: false, reason: 'too_high' })
  assert.deepEqual(gate({ ...onTheirLine, rung: 3 }, 3, working), { ok: true }, 'and standing on their line is pointing at their code')
})

test('a dry run that does not hold together is refused rather than drawn', () => {
  const idea: Hint = { rung: 2, say: 'Two pointers, one at each end.', lines: [], names: [], trace: WALK }
  const offTheEnd = { ...WALK, steps: [{ ...WALK.steps[0]!, marks: [{ at: 4, label: 'R' }] }] }
  assert.deepEqual(gate({ ...idea, trace: offTheEnd }, 3, working), { ok: false, reason: 'broken_trace' })
  const shortRow = { ...WALK, steps: [{ ...WALK.steps[0]!, values: [] }] }
  assert.deepEqual(gate({ ...idea, trace: shortRow }, 3, working), { ok: false, reason: 'broken_trace' })
  const noSuchLine = { ...WALK, steps: [{ ...WALK.steps[0]!, line: 9 }] }
  assert.deepEqual(gate({ ...idea, rung: 3, trace: noSuchLine }, 3, working), { ok: false, reason: 'unverified' })
})

test('code in the steps of a dry run is the top of the ladder, whatever the rung says', () => {
  const smuggled: Trace = {
    ...WALK,
    steps: [
      { values: ['8'], marks: [], note: 'seen[n] = i' },
      { values: ['6'], marks: [], note: 'return [seen[target - n], i]' }
    ]
  }
  const hint: Hint = { rung: 3, say: 'Here is how it goes.', lines: [], names: ['seen'], trace: smuggled }
  assert.deepEqual(gate(hint, 3, working), { ok: false, reason: 'too_high' })
  assert.deepEqual(gate(hint, 4, working), { ok: false, reason: 'too_high' }, 'the steps are not the code in pieces')
  assert.deepEqual(gate(hint, 5, working), { ok: true })
  const narrated: Trace = {
    ...WALK,
    steps: [
      { values: ['8'], marks: [], note: 'if the sum is over, R steps in' },
      { values: ['6'], marks: [], note: 'if the sum is under, L steps in' }
    ]
  }
  assert.deepEqual(gate({ ...hint, names: [], rung: 2, trace: narrated }, 2, working), { ok: true }, 'a sentence that starts with if is still a sentence')
  // A say that ends by introducing the picture has kept its promise.
  const intro: Hint = { rung: 4, say: 'Watch the two ends walk in:', lines: [], names: [], trace: WALK }
  assert.deepEqual(gate(intro, 4, working), { ok: true })
})
