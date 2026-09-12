import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { ZodType } from 'zod'
import type { Mark, Tier, WorkEvent } from '../../shared/leetcode.ts'
import type { OrbState, Suggestion, ThreadItem } from '../../shared/types.ts'
import type { Ask, LlmLike } from '../llm/service.ts'
import { WITHHELD } from './coach.ts'
import { CLIMB_EVERY } from './ladder.ts'
import { LeetCodePractice } from './practice.ts'

/** Answers the hint schema from a queue, and keeps every prompt it was sent. */
class ScriptedCoach implements LlmLike {
  readonly available = true
  readonly asks: Ask[] = []
  queue: { rung: number; say: string; lines: number[]; names: string[] }[] = []

  async json<T>(schema: ZodType<T>, ask: Ask): Promise<T> {
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
  const start = async () => {
    await practice.observe({ kind: 'opened', at: clock, problem: PROBLEM })
    await practice.observe({ kind: 'attention', at: clock, inFront: true })
    await practice.observe({ kind: 'changed', at: clock, code: CODE, language: 'python' })
  }
  return { llm, practice, said, marks, orbs, recorded, at, start, suggestions: () => suggestions, focus: () => focus }
}

test('the state is said first, and hands off never volunteers past it', async () => {
  const h = harness('hands_off')
  await h.start()
  assert.equal(h.said[0]!.text, 'Two Sum, easy. Nothing written yet. You have me on Hands off.')
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
