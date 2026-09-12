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
import type { Account } from './interviews/sources.ts'
import type { Ask, LlmLike } from './llm/service.ts'
import { EMPTY_PROFILE } from './profile.ts'
import { listed, Session, firstSentence } from './session.ts'

/**
 * A model that answers from a script, so the orchestration can be checked
 * without a network: which prompts get sent, and what the app does with the
 * replies. Every prompt it is given is kept for inspection.
 */
class ScriptedLlm implements LlmLike {
  /** What the model names when the fixed vocabulary misses. Null echoes the quote. */
  runtimeSkill: string | null = null
  available = true
  readonly asks: Ask[] = []
  /** How long a call sits in flight, so overlapping work can be tested. */
  delayMs = 0
  /** Null for a file the model finds nothing in, which comes back as no concepts. */
  concept: { name: string; summary: string; confidence: 'high' } | null = {
    name: 'sampling variability',
    summary: 'Sample means move around',
    confidence: 'high'
  }
  terms = ['A/B testing', 'experimentation', 'not a real term at all']

  async json<T>(schema: ZodType<T>, ask: Ask): Promise<T> {
    if (!this.available) throw new Error('no model configured')
    this.asks.push(ask)
    if (this.delayMs > 0) await new Promise((done) => setTimeout(done, this.delayMs))
    if (ask.system.includes('did not resolve to the fixed skill vocabulary')) {
      const evidence = [...ask.user.matchAll(/\[S:([^\]]+)\] ([^\n]+)/g)]
      const ids = evidence.map((match) => match[1]!)
      const first = evidence[0]
      const echoed = first
        ? first[2]!
            .toLowerCase()
            .replace(/[^a-z0-9 ]+/g, ' ')
            .split(/\s+/)
            .sort((a, b) => b.length - a.length)
            .slice(0, 2)
            .join(' ')
        : 'nothing'
      return schema.parse({
        skill: this.runtimeSkill ?? echoed,
        citations: [ids[0], 'not-a-real-id'].filter(Boolean),
        oneLiner: 'This is the part interviews test because production code still needs clean fundamentals.'
      }) as T
    }
    return schema.parse(this.reply(schema, ask)) as T
  }

  /** The brief is the one call that comes back whole, so this answers as one. */
  async text(ask: Ask): Promise<string> {
    this.asks.push(ask)
    return 'Four rounds, and the debugging one is the hard one. [S:hn:1#0] Nobody said otherwise. [S:made-up]'
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

  private reply(schema: ZodType<unknown>, ask: Ask): unknown {
    if (schema === conceptsOut) {
      return conceptsOut.parse(this.concept ? { concepts: [this.concept] } : {})
    }
    if (schema === termsOut) {
      return {
        terms: this.terms,
        oneLiner: 'That wobble in the sample mean is what half of product work argues about.'
      }
    }
    if (schema === profileOut) {
      return { major: 'Computer Science', year: 'junior', courses: [], targetRoles: ['swe'], interests: [] }
    }
    if (schema === hintOut) {
      // Asked to see it step by step, the coach draws the idea on an example of its own.
      if (ask.user.includes('step by step')) {
        return {
          rung: 2,
          say: 'Two pointers, one at each end, walking in.',
          lines: [],
          names: [],
          trace: {
            input: 'a sorted array [1, 3, 5, 7], looking for a pair that makes 6',
            items: ['1', '3', '5', '7'],
            columns: ['sum'],
            steps: [
              { values: ['8'], marks: [{ at: 0, label: 'L' }, { at: 3, label: 'R' }], note: '1 and 7 make 8, over 6, so R steps in' },
              { values: ['6'], marks: [{ at: 0, label: 'L' }, { at: 2, label: 'R' }], note: '1 and 5 make 6, the pair' }
            ]
          }
        }
      }
      return { rung: 1, say: 'What do you need to have seen before n to answer at n?', lines: [], names: [] }
    }
    throw new Error('no scripted reply for that schema')
  }
}

function harness(
  llm: ScriptedLlm,
  ikb: Ikb,
  extra: Partial<ConstructorParameters<typeof Session>[0]> = {}
): { session: Session; thread: ThreadItem[]; states: Partial<CompanionState>[] } {
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
      // The renderer's store does the same: an ended line stops streaming.
      end: (id, patch) => {
        const line = thread.find((item) => item.id === id)
        if (line) Object.assign(line, patch, { streaming: false })
      },
      card: () => undefined,
      recap: () => undefined
    },
    loadProfile: () => profile,
    saveProfile: (next) => {
      profile = next
    },
    ...extra
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

test('a vocabulary miss can still map to runtime evidence from postings', async () => {
  const llm = new ScriptedLlm()
  llm.concept = {
    name: 'sliding window',
    summary: 'A LeetCode array technique for keeping a moving range of values.',
    confidence: 'high'
  }
  llm.terms = ['not a real term at all']
  const { session, thread } = harness(llm, ikb)
  await teach(session)

  const said = thread.map((item) => item.text).join('\n')
  assert.doesNotMatch(said, /barely mention/)

  const withEvidence = thread.find((item) => item.evidence)
  assert.ok(withEvidence?.evidence)
  assert.ok(withEvidence.evidence.url.startsWith('http'))
  // The term never passed through the vocabulary, so the quote beside it has to
  // be a quote that says it.
  const quote = withEvidence.evidence.sentence.text.toLowerCase()
  const named = said.match(/it reads as ([^,]+), and I have/)
  assert.ok(named)
  assert.ok(named[1]!.split(' ').every((word) => quote.includes(word.toLowerCase())))
})

test('a term the postings never say is not said out loud either', async () => {
  // Nothing checked the runtime skill against the quotes, so the model could
  // name any phrase it liked and the companion read it out as what industry
  // calls the concept.
  const llm = new ScriptedLlm()
  llm.concept = {
    name: 'sliding window',
    summary: 'A LeetCode array technique for keeping a moving range of values.',
    confidence: 'high'
  }
  llm.terms = ['not a real term at all']
  llm.runtimeSkill = 'Chief Happiness Officer'
  const { session, thread } = harness(llm, ikb)
  await teach(session)

  const said = thread.map((item) => item.text).join('\n')
  assert.doesNotMatch(said, /Chief Happiness Officer/)
  assert.match(said, /barely mention/)
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

test('startOnboarding asks its greeting once and does not repeat if re-triggered', async () => {
  const llm = new ScriptedLlm()
  const { session, thread } = harness(llm, ikb)
  session.state.onboarded = false
  await session.startOnboarding()
  assert.equal(thread.length, 1)
  assert.match(thread[0]!.text, /Before we start/)

  // Re-triggering does not repeat the question
  await session.startOnboarding()
  assert.equal(thread.length, 1)
})

test('onboarding turn informs user if model is not configured', async () => {
  const llm = new ScriptedLlm()
  llm.available = false
  const { session, thread } = harness(llm, ikb)
  session.state.onboarded = false
  await session.startOnboarding()
  await session.typed('Computer science')
  await session.typed('Web development')
  assert.match(thread.at(-1)!.text, /no model is configured/i)
  assert.equal(session.state.onboarded, true)
})

test('asking about an interview at a company reads the accounts, not the postings', async () => {
  const llm = new ScriptedLlm()
  const asked: string[] = []
  const { session, thread } = harness(llm, ikb, {
    gatherInterviews: async (company) => {
      asked.push(company)
      return [
        {
          id: 'hn:1',
          source: 'hn',
          title: 'Ask HN',
          text: 'The Stripe interview was four rounds and the debugging round was the hard one for me.',
          url: 'https://news.ycombinator.com/item?id=1',
          at: Date.now()
        }
      ]
    }
  })
  await session.chat("what's the stripe interview like")
  assert.deepEqual(asked, ['Stripe'])
  assert.ok(llm.lastAsk('first-hand account'), 'the brief was asked for')
  assert.ok(!llm.lastAsk("never do a student's homework"), 'and companion chat was not')
  const answer = thread.at(-1)!
  assert.doesNotMatch(answer.text, /\[S:/, 'the markers never reach the student')
  assert.deepEqual(answer.citations, ['hn:1#0'], 'an invented id is not credited, a real one is')
  assert.equal(answer.sources?.[0]?.url, 'https://news.ycombinator.com/item?id=1', 'and the chip opens the account')
})

test('with nothing to read, the companion says so and still answers the question', async () => {
  const llm = new ScriptedLlm()
  const { session, thread } = harness(llm, ikb, { gatherInterviews: async () => [] })
  await session.chat('I have an interview at Stripe on Monday, does my profile fit their backend postings?')
  assert.ok(thread.some((item) => /nothing first-hand about a Stripe interview/.test(item.text)))
  assert.ok(!llm.lastAsk('first-hand account'), 'no brief with nothing to cite')
  assert.ok(llm.lastAsk("never do a student's homework"), 'the question itself still reaches the companion')
})

test('a line that breaks off mid-stream is closed as it stands', async () => {
  const llm = new ScriptedLlm()
  llm.stream = async (_ask, onToken) => {
    onToken('Half a ')
    throw new Error('the endpoint went away')
  }
  const { session, thread } = harness(llm, ikb)
  await session.chat('what do teams use for testing')
  const broken = thread.find((item) => item.text === 'Half a ')
  assert.ok(broken, 'what was said stays in the thread')
  assert.equal(broken.streaming, false, 'and the caret stops')
  assert.match(thread.at(-1)!.text, /could not answer that/)
})

test('a problem open in chrome takes the composer, but not an interview ask', async () => {
  const llm = new ScriptedLlm()
  const asked: string[] = []
  const { session } = harness(llm, ikb, {
    gatherInterviews: async (company) => {
      asked.push(company)
      return []
    }
  })
  await session.observe({
    kind: 'opened',
    at: Date.now(),
    problem: { slug: 'two-sum', title: 'Two Sum', difficulty: 'Easy', statement: 'Find two numbers.' }
  })
  assert.equal(session.state.composer.mode, 'leetcode')

  await session.typed('why is my loop wrong')
  assert.deepEqual(asked, [], 'a question about the code reaches the coach')

  await session.typed('what is the Stripe interview like')
  assert.deepEqual(asked, ['Stripe'], 'and one about an interview does not')
  assert.equal(session.state.composer.mode, 'leetcode', 'the problem still has the composer afterwards')
})

test('what the practice says reaches the orb while the panel is shut', async () => {
  const llm = new ScriptedLlm()
  const { session, states } = harness(llm, ikb)
  session.setExpanded(false)
  await session.observe({
    kind: 'opened',
    at: Date.now(),
    problem: { slug: 'two-sum', title: 'Two Sum', difficulty: 'Easy', statement: 'Find two numbers.' }
  })
  const whispered = states.filter((patch) => patch.whisper).at(-1)?.whisper
  assert.ok(whispered, 'the student working in chrome is told there is something to read')
  assert.equal(whispered.text, 'Two Sum, easy.')

  // With the panel open there is nothing to nudge them about: they can see it.
  session.setExpanded(true)
  const before = states.filter((patch) => patch.whisper).length
  await session.observe({ kind: 'outcome', at: Date.now(), outcome: { verdict: 'time_limit', detail: '' } })
  assert.equal(states.filter((patch) => patch.whisper).length, before)
})

test('a whisper is one sentence, and never a wall of code', () => {
  assert.equal(firstSentence('Two Sum, easy. Nothing written yet. You have me on Coach.'), 'Two Sum, easy.')
  assert.equal(firstSentence("Here's the working code:\n```python\nseen = {}\n```"), "Here's the working code:")
  assert.equal(firstSentence('What resets count between windows?'), 'What resets count between windows?')
  assert.ok(firstSentence('x'.repeat(200)).length <= 90)
})

test('a line typed while the companion is busy is shown at once and answered after', async () => {
  const llm = new ScriptedLlm()
  llm.delayMs = 40
  const { session, thread } = harness(llm, ikb)
  const first = session.chat('what do teams use for testing')
  await session.chat('and what about code review')
  await first
  const mine = thread.filter((item) => item.speaker === 'user').map((item) => item.text)
  assert.deepEqual(mine, ['what do teams use for testing', 'and what about code review'], 'neither line vanished')
  assert.equal(thread.filter((item) => item.speaker === 'companion').length, 2, 'and both were answered')
})

test('asking to be walked through it reaches the coach, and the dry run rides out with the line', async () => {
  const llm = new ScriptedLlm()
  const { session, thread } = harness(llm, ikb)
  await session.observe({
    kind: 'opened',
    at: Date.now(),
    problem: { slug: 'two-sum', title: 'Two Sum', difficulty: 'Easy', statement: 'Find two numbers.' }
  })
  await session.observe({ kind: 'changed', at: Date.now(), code: 'def twoSum(nums, target):\n    pass', language: 'python' })
  await session.run({ kind: 'trace' })

  const asked = llm.lastAsk('LeetCode problem')
  assert.ok(asked, 'the coach was asked, not the companion chat')
  assert.match(asked.user, /step by step/, 'in the words on the chip')
  assert.equal(thread.at(-2)!.speaker, 'user', 'and those words are the student\'s own line in the thread')
  const drawn = thread.at(-1)!
  assert.equal(drawn.rung, 2)
  assert.equal(drawn.trace?.steps.length, 2, 'the picture is on the line the renderer draws')
  assert.deepEqual(drawn.trace?.items, ['1', '3', '5', '7'])
})

test('a lecture with no words in it says so rather than answering from the last one', async () => {
  // A scanned deck reads as an empty string. Falling through left the previous
  // lecture in the transcript, so the companion answered about that instead.
  const llm = new ScriptedLlm()
  const { session, thread } = harness(llm, ikb)
  await teach(session)
  const before = thread.length

  await session.useNotes('   \n  ')
  const said = thread.slice(before).map((item) => item.text).join('\n')
  assert.match(said, /no words in that one/)
  assert.equal(llm.asks.filter((ask) => ask.system.includes('name what is being taught')).length, 1)
})

test('two lectures in a row are both read, not one dropped for being busy', async () => {
  // why() used to return early on the busy flag, so a second upload while the
  // first was still being read went nowhere at all.
  const llm = new ScriptedLlm()
  llm.delayMs = 5
  const { session } = harness(llm, ikb)

  await Promise.all([teach(session), teach(session)])
  const reads = llm.asks.filter((ask) => ask.system.includes('name what is being taught')).length
  assert.equal(reads, 2)
})

test('the opening questions are not asked again after a launch with no model', async () => {
  // onboarded was worked out from the answers, and the answers are empty when
  // no model could read them, so the same two questions came back every launch.
  const llm = new ScriptedLlm()
  llm.available = false
  let saved: Profile = { ...EMPTY_PROFILE }
  const first = harness(llm, ikb, { loadProfile: () => saved, saveProfile: (next) => void (saved = next) })
  await first.session.startOnboarding()
  await first.session.typed('computer science, second year')
  await first.session.typed('backend, and I like databases')

  assert.equal(saved.onboarded, true)
  const second = harness(llm, ikb, { loadProfile: () => saved, saveProfile: () => undefined })
  assert.equal(second.session.state.onboarded, true)
})

test('a second lecture is what the companion reads, not the first one again', async () => {
  // The window was the last few minutes of everything handed over, and the
  // concept is named from the top of it, so uploading a second lecture inside
  // three minutes answered about the first.
  const llm = new ScriptedLlm()
  const { session } = harness(llm, ikb)
  await teach(session)
  await session.useNotes(
    [
      'Right, processes and threads. A process gets its own address space and a thread does not.',
      'That is why two threads in one process can stamp on each other through a shared counter.',
      'We fixed it with a mutex, then broke it again by taking two locks in the wrong order.',
      'Hold and wait, no preemption, circular wait. That is a deadlock and you will meet one.'
    ].join('\n')
  )

  const reads = llm.asks.filter((ask) => ask.system.includes('name what is being taught'))
  assert.equal(reads.length, 2)
  assert.match(reads[1]!.user, /deadlock/)
  assert.doesNotMatch(reads[1]!.user, /Sampling variability/)
})

test('a guess at a company that no write-up is titled for is answered as ordinary chat', async () => {
  // The sentence cannot tell "with Sarah from recruiting" from "with Two Sigma
  // next week", so the boards do. Hacker News answers a search for Sarah with
  // whatever mentions Sarah, and none of it is titled for her.
  const llm = new ScriptedLlm()
  const accounts: Account[] = [
    {
      id: 'hn:1',
      source: 'hn',
      title: 'Who is Satoshi Nakamoto? My quest to unmask him',
      text: 'I once sat an interview where the whole loop was about consensus algorithms and nobody explained why.',
      url: 'https://news.ycombinator.com/item?id=1',
      at: Date.now()
    }
  ]
  const { session, thread } = harness(llm, ikb, { gatherInterviews: async () => accounts })
  await session.chat('interview with Sarah from recruiting, what should I ask her?')

  const said = thread.filter((item) => item.speaker === 'companion').map((item) => item.text).join('\n')
  assert.doesNotMatch(said, /Sarah/, 'the companion never says the name back')
  assert.ok(!llm.lastAsk('first-hand account'), 'no brief was written about a person')
  assert.ok(llm.lastAsk("never do a student's homework"), 'the line was answered like any other')
})

test('a company the base knows is told plainly when the boards hold nothing', async () => {
  const llm = new ScriptedLlm()
  const { session, thread } = harness(llm, ikb, { gatherInterviews: async () => [] })
  await session.chat('what is the interview at Stripe like?')
  assert.ok(thread.some((item) => /nothing first-hand about a Stripe interview/.test(item.text)))
})

test('two lectures dropped in quickly are read as two lectures', async () => {
  // take() ran outside the queue, so the second lecture replaced what the first
  // read was going to read before that read had started, and both came back as
  // the second one.
  const llm = new ScriptedLlm()
  llm.delayMs = 5
  const { session } = harness(llm, ikb)
  const second = [
    'Right, processes and threads. A process gets its own address space and a thread does not.',
    'That is why two threads in one process can stamp on each other through a shared counter.',
    'We fixed it with a mutex, then broke it again by taking two locks in the wrong order.',
    'Hold and wait, no preemption, circular wait. That is a deadlock and you will meet one.'
  ].join('\n')

  await Promise.all([teach(session), session.useNotes(second)])
  const reads = llm.asks.filter((ask) => ask.system.includes('name what is being taught'))
  assert.equal(reads.length, 2)
  assert.match(reads[0]!.user, /Sampling variability/)
  assert.match(reads[1]!.user, /deadlock/)
})

test('the recap says what landed in words a person would use', () => {
  assert.equal(listed(['Hash tables']), 'Hash tables')
  assert.equal(listed(['Hash tables', 'Recursion']), 'Hash tables and Recursion')
  assert.equal(listed(['Hash tables', 'Recursion', 'Dynamic programming']), 'Hash tables, Recursion and Dynamic programming')
})

test('notes pasted into the composer are read as a lecture, not answered as a question', async () => {
  // The empty panel says "Upload a lecture or paste your notes", and nothing
  // called the path that does it: a paste went to chat and never became a card.
  const llm = new ScriptedLlm()
  const { session, thread } = harness(llm, ikb)
  await session.typed(LECTURE.join('\n'))

  assert.ok(llm.lastAsk('name what is being taught'), 'the paste was read as a lecture')
  assert.ok(!llm.lastAsk("never do a student's homework"), 'and not answered as a question')
  assert.ok(thread.some((item) => item.speaker === 'user'), 'what they pasted is in the thread')
})

test('a long typed question is still a question', async () => {
  const llm = new ScriptedLlm()
  const { session } = harness(llm, ikb)
  await session.typed(
    'I have been going back and forth on this for a while and I wanted to ask you properly, because it keeps coming up when I read postings for backend work and I am never sure what they actually mean by it in practice on a real team'
  )
  assert.ok(llm.lastAsk("never do a student's homework"), 'answered as a question')
  assert.ok(!llm.lastAsk('name what is being taught'), 'and not read as a lecture')
})

test('a wall of text pasted with a problem open goes to the coach, not the lecture reader', async () => {
  // With LeetCode in view that is a stack trace or their own code far more
  // often than it is lecture notes.
  const llm = new ScriptedLlm()
  const { session } = harness(llm, ikb)
  await session.observe({ kind: 'opened', at: Date.now(), problem: { slug: 'two-sum', title: 'Two Sum', difficulty: 'Easy', statement: 'add up to target' } })
  assert.equal(session.state.composer.mode, 'leetcode')
  await session.typed(LECTURE.join('\n'))
  assert.ok(!llm.lastAsk('name what is being taught'), 'not read as a lecture while a problem is open')
})

test('a file the model finds nothing in is said plainly, not as a schema error', async () => {
  // A conference deck came back as {} and the student was shown zod's own
  // complaint: expected array, received undefined, in JSON, under "I could not
  // read that back just then."
  const llm = new ScriptedLlm()
  llm.concept = null
  const { session, thread } = harness(llm, ikb)
  await teach(session)

  const said = thread.filter((item) => item.speaker === 'companion').map((item) => item.text).join('\n')
  assert.match(said, /not enough in that for me to work with/)
  assert.doesNotMatch(said, /schema|expected|invalid_type|undefined/i)
})
