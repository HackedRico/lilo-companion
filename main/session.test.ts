import assert from 'node:assert/strict'
import { before, test } from 'node:test'
import { resolve } from 'node:path'
import type { ZodType } from 'zod'
import {
  conceptsOut,
  hintOut,
  profileOut,
  termsOut
} from '../shared/schemas.ts'
import type { CompanionState, Profile, ThreadItem } from '../shared/types.ts'
import { loadIkb, type Ikb } from './ikb/load.ts'
import type { Ask, LlmLike } from './llm/service.ts'
import { EMPTY_PROFILE } from './profile.ts'
import { Session } from './session.ts'

/**
 * A model that answers from a script, so the orchestration can be checked
 * without a network: which prompts get sent, and what the app does with the
 * replies. Every prompt it is given is kept for inspection.
 */
class ScriptedLlm implements LlmLike {
  readonly available = true
  readonly asks: Ask[] = []
  /** How long a call sits in flight, so overlapping work can be tested. */
  delayMs = 0

  async json<T>(schema: ZodType<T>, ask: Ask): Promise<T> {
    this.asks.push(ask)
    if (this.delayMs > 0) await new Promise((done) => setTimeout(done, this.delayMs))
    return schema.parse(this.reply(schema)) as T
  }

  async text(ask: Ask): Promise<string> {
    this.asks.push(ask)
    return 'Oh, that was our holiday sale week. Does that matter?'
  }

  async stream(ask: Ask, onToken: (token: string) => void): Promise<string> {
    this.asks.push(ask)
    const text = 'Teams run this constantly. [S:not-a-real-id] Worth knowing.'
    for (const token of text.split(' ')) onToken(`${token} `)
    return text
  }

  /** The last prompt sent for a given kind of call. */
  lastAsk(matching: string): Ask | undefined {
    return [...this.asks].reverse().find((ask) => ask.system.includes(matching))
  }

  private reply(schema: ZodType<unknown>): unknown {
    if (schema === conceptsOut) {
      return {
        concepts: [
          { name: 'sampling variability', summary: 'Sample means move around', confidence: 'high' }
        ]
      }
    }
    if (schema === termsOut) {
      return {
        terms: ['A/B testing', 'experimentation', 'not a real term at all'],
        oneLiner: 'That wobble in the sample mean is what half of product work argues about.'
      }
    }
    if (schema === profileOut) {
      return { major: 'Computer Science', year: 'junior', courses: [], targetRoles: ['swe'], interests: [] }
    }
    if (schema === hintOut) {
      return { rung: 1, say: 'What do you need to have seen before n to answer at n?', lines: [], names: [] }
    }
    throw new Error('no scripted reply for that schema')
  }
}

function harness(llm: ScriptedLlm, ikb: Ikb): { session: Session; thread: ThreadItem[]; states: Partial<CompanionState>[] } {
  const thread: ThreadItem[] = []
  const states: Partial<CompanionState>[] = []
  let profile: Profile = { ...EMPTY_PROFILE, targetRoles: ['backend'] }

  const session = new Session({
    llm,
    ikb,
    pace: { word: 0, turn: 0 },
    emit: {
      patch: (patch) => states.push(patch),
      add: (item) => thread.push(item),
      token: (id, token) => {
        const line = thread.find((item) => item.id === id)
        if (line) line.text += token
      },
      end: (id, patch) => {
        const line = thread.find((item) => item.id === id)
        if (line && patch) Object.assign(line, patch)
      },
      card: () => undefined,
      recap: () => undefined
    },
    loadProfile: () => profile,
    saveProfile: (next) => {
      profile = next
    }
  })
  return { session, thread, states }
}

/** Long enough that the extractor treats it as a lecture rather than a fragment. */
const LECTURE = [
  'Okay, today I want to move on to something that trips up basically everybody the first time.',
  'Sampling variability. If I take fifty students and measure them, I get a mean.',
  'If I do it again tomorrow with a different fifty, I get a different number.',
  'That gap is not a mistake. It is a property of sampling itself.',
  'The standard error of the mean is sigma over the square root of n, so four times the data buys twice the precision.'
]

/** The lecture arrives whole, the way an upload or a paste does. */
async function teach(session: Session): Promise<void> {
  await session.useNotes(LECTURE.join('\n'))
}

let ikb: Ikb

before(async () => {
  ikb = await loadIkb(resolve(import.meta.dirname, '../data'))
})

test('a card only claims terms the postings actually carry', async () => {
  const llm = new ScriptedLlm()
  const { session, thread } = harness(llm, ikb)
  await teach(session)

  const said = thread.map((item) => item.text).join('\n')
  assert.match(said, /A\/B testing/, 'it names the term the postings use')
  assert.doesNotMatch(said, /not a real term at all/, 'an invented term never reaches the student')

  const withEvidence = thread.find((item) => item.evidence)
  assert.ok(withEvidence?.evidence, 'the claim arrives with a real posting sentence')
  assert.ok(withEvidence.evidence.url.startsWith('http'), 'and a link back to it')
})

test('what the student types routes to onboarding, leetcode, or chat', async () => {
  const llm = new ScriptedLlm()
  const { session } = harness(llm, ikb)

  // In chat mode by default
  assert.equal(session.state.composer.mode, 'chat')
  await session.typed('how do teams test changes')
  const asked = llm.lastAsk('You are a companion')
  assert.ok(asked, 'general question went to companion chat')
})

test('a watched concept alerts when a lecture reaches it', async () => {
  const llm = new ScriptedLlm()
  const { session, thread } = harness(llm, ikb)
  await session.run({ kind: 'watch', concept: 'hypothesis testing' })
  assert.deepEqual(session.state.watching, ['hypothesis testing'])

  // The wrong lecture does not wake them.
  await session.useNotes('Right, today we are carrying on with descriptive statistics.')
  assert.equal(session.state.orb, 'idle')
  assert.deepEqual(session.state.watching, ['hypothesis testing'])

  // The right one does.
  await session.useNotes('Today we answer that question. This is hypothesis testing.')
  assert.equal(session.state.orb, 'alert')
  assert.deepEqual(session.state.watching, [])
  assert.match(thread.at(-1)!.text, /hypothesis testing/)
})

test('recap highlights gaps and offers to watch them', async () => {
  const llm = new ScriptedLlm()
  const { session } = harness(llm, ikb)
  await teach(session)
  await session.showRecap()

  const watchSuggestion = session.state.suggestions.find((s) => s.intent.kind === 'watch')
  assert.ok(watchSuggestion, 'recap offers to watch for missing practices')
})

test('a citation the retriever never returned is stripped from the answer', async () => {
  const llm = new ScriptedLlm()
  const { session, thread } = harness(llm, ikb)
  await session.chat('how do teams actually test a change')

  const answer = thread.at(-1)!
  assert.doesNotMatch(answer.text, /\[S:/, 'the markers never reach the student')
  assert.deepEqual(answer.citations, [], 'and an invented id is not credited')
})

test('a problem in view takes the composer, and what is typed reaches the coach', async () => {
  const llm = new ScriptedLlm()
  const { session, thread } = harness(llm, ikb)
  await session.observe({
    kind: 'opened',
    at: Date.now(),
    problem: { slug: 'two-sum', title: 'Two Sum', difficulty: 'Easy', statement: 'Find two numbers.' }
  })
  assert.equal(session.state.composer.mode, 'leetcode')
  assert.match(thread.at(-1)!.text, /^Two Sum, easy\./, 'the state is said first, in plain words')

  await session.observe({ kind: 'changed', at: Date.now(), code: 'def twoSum(nums, target):\n    pass', language: 'python' })
  await session.typed('is a loop the right shape here')
  const asked = llm.lastAsk('LeetCode problem')
  assert.ok(asked, 'the coach was asked, not the companion chat')
  assert.match(asked.system, /ceiling right now is rung 3/, 'at the tier the student picked, coach')
  assert.equal(thread.at(-1)!.rung, 1, 'and the hint carries its rung')

  await session.observe({ kind: 'closed', at: Date.now() })
  assert.equal(session.state.composer.mode, 'chat')
})
