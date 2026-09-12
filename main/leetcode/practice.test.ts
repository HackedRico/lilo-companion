import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { ZodType } from 'zod'
import type { Mark, Tier, Trace, WorkEvent } from '../../shared/leetcode.ts'
import type { OrbState, Suggestion, ThreadItem } from '../../shared/types.ts'
import type { Ask, LlmLike } from '../llm/service.ts'
import { WITHHELD, WITHHELD_UNASKED } from './coach.ts'
import { CLIMB_EVERY } from './ladder.ts'
import { LeetCodePractice, TRACE_QUESTION } from './practice.ts'

/** Answers the hint schema from a queue, and keeps every prompt it was sent. */
class ScriptedCoach implements LlmLike {
  available = true
  readonly asks: Ask[] = []
  queue: { rung: number; say: string; lines: number[]; names: string[]; trace?: Trace }[] = []

  async json<T>(schema: ZodType<T>, ask: Ask): Promise<T> {
    if (!this.available) throw new Error('no model configured')
    this.asks.push(ask)
    const next = this.queue.shift()
    if (!next) throw new Error('nothing scripted')
    return schema.parse(next) as T
  }

  async text(): Promise<string> {
    throw new Error('not used')
  }

  async stream(): Promise<string> {
    throw new Error('not used')
  }
}

const PROBLEM = { slug: 'two-sum', title: 'Two Sum', difficulty: 'Easy', statement: 'Find two numbers.' }
const CODE = 'def twoSum(nums, target):\n    seen = {}\n    for i, n in enumerate(nums):\n        seen[n] = i\n    return []'

/** Two pointers walking in from the ends, on an example of the coach's own. */
const WALK: Trace = {
  input: 'a sorted array [1, 3, 5, 7], looking for a pair that makes 6',
  items: ['1', '3', '5', '7'],
  columns: ['sum'],
  steps: [
    { values: ['8'], marks: [{ at: 0, label: 'L' }, { at: 3, label: 'R' }], note: '1 and 7 make 8, over 6, so R steps in' },
    { values: ['6'], marks: [{ at: 0, label: 'L' }, { at: 2, label: 'R' }], note: '1 and 5 make 6, the pair' }
  ]
}

function harness(tier: Tier = 'coach') {
  const llm = new ScriptedCoach()
  const said: ThreadItem[] = []
  const marks: Mark[] = []
  const orbs: OrbState[] = []
  const recorded: WorkEvent[] = []
  let suggestions: Suggestion[] = []
  let focus: string | null = null
  let clock = 0
  let ids = 0
  const practice = new LeetCodePractice({
    llm,
    tier: () => tier,
    now: () => clock,
    nextId: () => String(++ids),
    record: (event) => void recorded.push(event),
    voice: {
      say: async (text, extra) => void said.push({ id: String(++ids), speaker: 'companion', text, at: clock, ...extra }),
      suggest: (next) => (suggestions = next),
      orb: (state) => orbs.push(state),
      mark: (mark) => marks.push(mark),
      focus: (problem) => (focus = problem)
    }
  })
  const at = (ms: number) => (clock = ms)
  // The bridge hands every event straight to observe without waiting for the
  // one before it, so a recording that awaits each in turn is not what the
  // practice sees: the greeting would always time out waiting for code that
  // was already on its way.
  const start = async () => {
    const greeting = practice.observe({ kind: 'opened', at: clock, problem: PROBLEM })
    await practice.observe({ kind: 'attention', at: clock, inFront: true })
    await practice.observe({ kind: 'changed', at: clock, code: CODE, language: 'python' })
    await greeting
  }
  return { llm, practice, said, marks, orbs, recorded, at, start, suggestions: () => suggestions, focus: () => focus }
}

test('the state is said first, and hands off never volunteers past it', async () => {
  const h = harness('hands_off')
  await h.start()
  assert.equal(h.said[0]!.text, 'Two Sum, easy. 5 lines of python, last changed just now. You have me on Hands off.')
  assert.equal(h.focus(), 'Two Sum')
  h.at(CLIMB_EVERY * 5)
  await h.practice.tick()
  assert.equal(h.llm.asks.length, 0, 'no model was asked')
  assert.equal(h.said.length, 1, 'and nothing more was said')
})

test('a volunteered hint is earned after a minute and climbs one rung at a time', async () => {
  const h = harness('coach')
  await h.start()
  h.llm.queue.push({ rung: 1, say: 'What would you need to know before n to answer at n?', lines: [], names: [] })
  h.at(CLIMB_EVERY)
  await h.practice.tick()
  assert.match(h.llm.asks[0]!.system, /ceiling right now is rung 1/)
  assert.equal(h.said.at(-1)!.rung, 1)

  // The same code a minute later earns nothing.
  h.at(CLIMB_EVERY * 2)
  await h.practice.tick()
  assert.equal(h.llm.asks.length, 1)

  // An edit, and a minute, earns the next rung.
  await h.practice.observe({ kind: 'changed', at: CLIMB_EVERY * 2, code: `${CODE}\n# hmm`, language: 'python' })
  h.llm.queue.push({ rung: 2, say: 'This is the one pass with a map idea.', lines: [], names: [] })
  h.at(CLIMB_EVERY * 3 + 1)
  await h.practice.tick()
  assert.match(h.llm.asks[1]!.system, /ceiling right now is rung 2/)
  assert.equal(h.said.at(-1)!.rung, 2)
})

test('a hint above the ceiling is retried once, then withheld with an honest line', async () => {
  const h = harness('coach')
  await h.start()
  h.llm.queue.push(
    { rung: 4, say: 'Look up target minus n in seen before you store n.', lines: [4], names: ['seen'] },
    { rung: 4, say: 'Check seen for target minus n first.', lines: [4], names: ['seen'] }
  )
  await h.practice.observe({ kind: 'asked', at: 10, text: 'what am I missing' })
  assert.equal(h.llm.asks.length, 2)
  assert.match(h.llm.asks[1]!.system, /above the ceiling/, 'the second try is told why')
  assert.equal(h.said.at(-1)!.text, WITHHELD)
  assert.equal(h.marks.length, 0, 'nothing withheld reaches the page')
})

test('a hint that points at a line not in the code is retried, then dropped', async () => {
  const h = harness('tutor')
  await h.start()
  h.llm.queue.push(
    { rung: 3, say: 'Line 9 never runs.', lines: [9], names: [] },
    { rung: 3, say: 'You never read cache.', lines: [], names: ['cache'] }
  )
  await h.practice.observe({ kind: 'help', at: 10 })
  assert.match(h.llm.asks[1]!.system, /not in their code/)
  assert.equal(h.said.at(-1)!.text, 'I have nothing specific enough to say about that yet.')
})

test('an answer marks the lines it is about, and only those', async () => {
  const h = harness('coach')
  await h.start()
  h.llm.queue.push({ rung: 3, say: 'seen is filled on line 4 and never read.', lines: [4], names: ['seen'] })
  await h.practice.observe({ kind: 'asked', at: 10, text: 'why is it always empty' })
  assert.deepEqual(h.marks, [{ lines: [4] }])
  assert.equal(h.said.at(-1)!.rung, 3)
  assert.deepEqual(h.orbs, ['thinking', 'idle'])
})

test('accepted is cheered, and the better way waits to be asked for', async () => {
  const h = harness('coach')
  await h.start()
  await h.practice.observe({ kind: 'outcome', at: 20, outcome: { verdict: 'accepted', detail: '' } })
  assert.ok(h.orbs.includes('cheering'))
  assert.equal(h.said.at(-1)!.text, 'Accepted. That one is yours.')
  assert.ok(h.suggestions().some((s) => s.intent.kind === 'better'))
  h.at(CLIMB_EVERY * 5)
  await h.practice.tick()
  assert.equal(h.llm.asks.length, 0, 'nothing is volunteered on top of a pass')
})

test('a failed run is read back plainly, with no advice on top', async () => {
  const h = harness('coach')
  await h.start()
  await h.practice.observe({
    kind: 'outcome',
    at: 20,
    outcome: { verdict: 'wrong_answer', detail: '', input: '[3,3]', expected: '[0,1]', output: '[]' }
  })
  assert.equal(h.said.at(-1)!.text, 'The last run came back wrong answer: input [3,3], expected [0,1], got [].')
  assert.equal(h.llm.asks.length, 0)
})

test('every event is written down, the ceiling included', async () => {
  const h = harness('coach')
  await h.start()
  await h.practice.observe({ kind: 'ceiling', at: 5, tier: 'tutor' })
  assert.deepEqual(h.recorded.map((e) => e.kind), ['opened', 'attention', 'changed', 'ceiling'])
  assert.equal(h.said.at(-1)!.text, 'On Tutor now.')
})

test('asking for a hint informs the user if model is not configured', async () => {
  const h = harness('coach')
  await h.start()
  h.llm.available = false
  await h.practice.observe({ kind: 'asked', at: 10, text: 'Give me a hint' })
  assert.match(h.said.at(-1)!.text, /cannot coach you until a model is configured/i)
})

test('answering stops the timer piling on, and does not push the ladder up', async () => {
  const h = harness('tutor')
  await h.start()
  h.llm.queue.push({ rung: 5, say: 'Walk the array once, storing each value against its index.', lines: [], names: [] })
  await h.practice.observe({ kind: 'asked', at: 10, text: 'show me the answer' })
  assert.equal(h.llm.asks.length, 1)

  // The same code a minute later earns nothing, however high the answer was.
  h.at(CLIMB_EVERY * 2)
  await h.practice.tick()
  assert.equal(h.llm.asks.length, 1, 'nothing is volunteered on top of what was just answered')

  // An edit, and a minute, starts the climb at the bottom rather than at the ceiling.
  await h.practice.observe({ kind: 'changed', at: CLIMB_EVERY * 2, code: `${CODE}\n# hmm`, language: 'python' })
  h.llm.queue.push({ rung: 1, say: 'What do you need to have seen before n?', lines: [], names: [] })
  h.at(CLIMB_EVERY * 3 + 1)
  await h.practice.tick()
  assert.match(h.llm.asks[1]!.system, /ceiling right now is rung 1/, 'the ladder starts again from the bottom')
})

test('what is already in the editor is waited for before the state is read back', async () => {
  const h = harness('coach')
  const opened = h.practice.observe({ kind: 'opened', at: 0, problem: PROBLEM })
  // The page reports the editor a moment after it reports the problem.
  await new Promise((resolve) => setTimeout(resolve, 300))
  await h.practice.observe({ kind: 'changed', at: 1, code: CODE, language: 'python' })
  await opened
  assert.match(h.said[0]!.text, /5 lines of python/, 'not "nothing written yet" over a screen of code')
})

test('a question asked while the timer is thinking waits, and is never dropped', async () => {
  const h = harness('coach')
  await h.start()
  // The timer takes a hint, and the student presses the chip while it is out.
  h.llm.queue.push({ rung: 1, say: 'What do you need to have seen before n?', lines: [], names: [] })
  h.at(CLIMB_EVERY)
  const volunteering = h.practice.tick()
  await h.practice.observe({ kind: 'help', at: CLIMB_EVERY })
  await volunteering
  assert.equal(h.llm.asks.length, 2, 'the question was asked, not swallowed')
  assert.match(h.llm.asks[1]!.system, /ceiling right now is rung 3/, 'and at the tier the student set')
})

test('tutor climbs to the steps and still never volunteers the code', async () => {
  const h = harness('tutor')
  await h.start()
  // A minute and an edit apart, the way the student earns them.
  const earned = async (minute: number, hint: { rung: number; say: string; names?: string[] }) => {
    await h.practice.observe({ kind: 'changed', at: CLIMB_EVERY * minute, code: `${CODE}\n# ${minute}`, language: 'python' })
    h.llm.queue.push({ lines: [], names: [], ...hint })
    h.at(CLIMB_EVERY * (minute + 1) + 1)
    await h.practice.tick()
  }
  await earned(0, { rung: 1, say: 'What would you need to have seen before n to answer at n?' })
  await earned(2, { rung: 2, say: 'This one has a name: the single pass with a lookup table.' })
  await earned(4, { rung: 3, say: 'seen is filled and never read.', names: ['seen'] })
  assert.deepEqual(h.said.slice(-3).map((item) => item.rung), [1, 2, 3])

  // Rung 4 is the steps, and the model answers with the whole thing anyway.
  const solution = 'seen = {}\nfor i, n in enumerate(nums):\n    if target - n in seen:\n        return [seen[target - n], i]'
  await h.practice.observe({ kind: 'changed', at: CLIMB_EVERY * 6, code: `${CODE}\n# 6`, language: 'python' })
  h.llm.queue.push({ rung: 4, say: solution, lines: [], names: [] }, { rung: 4, say: solution, lines: [], names: [] })
  h.at(CLIMB_EVERY * 7 + 1)
  await h.practice.tick()
  assert.match(h.llm.asks.at(-1)!.system, /ceiling right now is rung 4/, 'asked for the steps')
  assert.ok(!h.said.some((item) => item.text.includes('return [seen')), 'and the answer was not handed over unasked')
  assert.equal(h.said.at(-1)!.text, WITHHELD_UNASKED)
  assert.equal(h.marks.length, 0)
})

test('the page saying again what is open is a repeat, not a new problem', async () => {
  const h = harness('coach')
  await h.start()
  const before = h.said.length
  // What the app asks for when it reconnects to a tab that has been sitting still.
  await h.practice.observe({ kind: 'opened', at: 20, problem: PROBLEM })
  assert.equal(h.said.length, before, 'the opening line is not said twice')
  assert.equal(h.practice.work.code, CODE, 'and what they had written is still what it knows')
})

test('a problem closed while the model is thinking is neither said nor marked', async () => {
  const h = harness('coach')
  await h.start()
  h.llm.queue.push({ rung: 3, say: 'seen is filled on line 4 and never read.', lines: [4], names: ['seen'] })
  const answering = h.practice.observe({ kind: 'asked', at: 10, text: 'why is it always empty' })
  // They shut the tab while the answer was on the wire.
  await h.practice.observe({ kind: 'closed', at: 11 })
  await answering
  assert.equal(h.llm.asks.length, 1, 'the model was asked')
  assert.ok(!h.said.some((item) => item.text.includes('seen is filled')), 'and nothing was said about code that is gone')
  assert.equal(h.marks.length, 0, 'nor marked on a page that has moved on')
  assert.deepEqual(h.suggestions(), [], 'and no chips are put back up for it')
})

test('asked to be walked through it, the coach draws a dry run and the line carries it', async () => {
  const h = harness('coach')
  await h.start()
  h.llm.queue.push({ rung: 2, say: 'Two pointers, one at each end, walking in.', lines: [], names: [], trace: WALK })
  await h.practice.observe({ kind: 'asked', at: 10, text: TRACE_QUESTION })
  assert.match(h.llm.asks[0]!.user, /step by step/, 'the ask reaches the model in the student\'s words')
  assert.equal(h.said.at(-1)!.rung, 2)
  assert.equal(h.said.at(-1)!.trace?.steps.length, 2, 'the picture rides out with the words')
  assert.ok(h.suggestions().some((s) => s.intent.kind === 'trace'), 'and a walk-through is on offer')
})

test('hands off is offered no walk-through, and a dry run that does not hold together is asked for again', async () => {
  const off = harness('hands_off')
  await off.start()
  assert.ok(!off.suggestions().some((s) => s.intent.kind === 'trace'), 'a picture of the idea is above hands off')

  const h = harness('coach')
  await h.start()
  const broken = { ...WALK, steps: [{ ...WALK.steps[0]!, marks: [{ at: 9, label: 'R' }] }] }
  h.llm.queue.push(
    { rung: 2, say: 'Two pointers, one at each end.', lines: [], names: [], trace: broken },
    { rung: 2, say: 'Two pointers, one at each end.', lines: [], names: [], trace: broken }
  )
  await h.practice.observe({ kind: 'asked', at: 10, text: TRACE_QUESTION })
  assert.match(h.llm.asks[1]!.system, /did not hold together/, 'the second try is told what was wrong with the picture')
  assert.equal(h.said.at(-1)!.text, 'I have nothing specific enough to say about that yet.')
  assert.equal(h.said.at(-1)!.trace, undefined, 'and nothing broken is drawn')
})

test('the greeting waits for the page to report, not for there to be code', async () => {
  // The bridge does not wait for one event to be handled before delivering the
  // next, so this is how they really arrive. Waiting for code rather than for
  // the report held the greeting the full settle every time a student opened a
  // problem they had not started, and cut off the code of one they had.
  const h = harness('coach')
  const greeting = h.practice.observe({ kind: 'opened', at: 0, problem: PROBLEM })
  await h.practice.observe({ kind: 'changed', at: 0, code: '', language: 'python' })
  const started = Date.now()
  await greeting
  assert.ok(Date.now() - started < 1000, 'the greeting did not sit out the settle')
  assert.equal(h.said[0]!.text, 'Two Sum, easy. Nothing written yet. You have me on Coach.')
})

test('code that arrives late is still what the greeting says', async () => {
  const h = harness('coach')
  const greeting = h.practice.observe({ kind: 'opened', at: 0, problem: PROBLEM })
  await new Promise((resolve) => setTimeout(resolve, 600))
  await h.practice.observe({ kind: 'changed', at: 0, code: CODE, language: 'python' })
  await greeting
  assert.match(h.said[0]!.text, /lines of python/)
})
