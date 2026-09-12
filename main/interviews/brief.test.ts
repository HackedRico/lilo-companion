import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { ZodType } from 'zod'
import type { Ask, LlmLike } from '../llm/service.ts'
import { ageOf, briefInterview, claims, degenerate, tidy } from './brief.ts'
import type { Account } from './sources.ts'

const ACCOUNTS: Account[] = [
  {
    id: 'leetcode:1',
    source: 'leetcode',
    title: 'Stripe SWE onsite',
    text: 'The onsite was four rounds over one day, and the debugging round was the hardest one by far. They gave me a real codebase and a failing test to fix.',
    url: 'https://leetcode.com/discuss/post/1/',
    at: 1_800_000_000_000
  }
]

/** Answers the brief from a queue, whole, the way llm.text does. */
class Scripted implements LlmLike {
  readonly available = true
  asks: Ask[] = []
  queue: string[] = []
  async json<T>(_schema: ZodType<T>): Promise<T> {
    throw new Error('not used')
  }
  async text(ask: Ask): Promise<string> {
    this.asks.push(ask)
    return this.queue.shift() ?? ''
  }
  async stream(): Promise<string> {
    throw new Error('not used')
  }
}

const NOW = 1_800_000_000_000 + 86_400_000 * 3

test('a claim keeps only the citations the accounts can back, and the sources point at them', async () => {
  const llm = new Scripted()
  llm.queue.push('Four rounds in a day, with a debugging round people found hard. [S:leetcode:1#0] Bring a debugger you know. [S:made-up] Done.')
  const brief = await briefInterview(llm, 'Stripe', ACCOUNTS, NOW)
  assert.equal(brief.kind, 'brief')
  if (brief.kind !== 'brief') return
  assert.doesNotMatch(brief.text, /\[S:/, 'markers never reach the student')
  assert.deepEqual(brief.citations, ['leetcode:1#0'])
  assert.equal(brief.sources.length, 1)
  assert.equal(brief.sources[0]!.company, 'Stripe SWE onsite')
  assert.equal(brief.sources[0]!.url, 'https://leetcode.com/discuss/post/1/')
  assert.match(llm.asks[0]!.user, /\[S:leetcode:1#0\] The onsite was four rounds/)
  assert.match(llm.asks[0]!.system, /1 first-hand account people posted publicly 3 days ago/)
})

test('a reply that fell apart is retried shorter and colder, then handed over as sources', async () => {
  const llm = new Scripted()
  llm.queue.push('Interview!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!', 'ok')
  const brief = await briefInterview(llm, 'Stripe', ACCOUNTS, NOW)
  assert.equal(llm.asks.length, 2)
  assert.equal(llm.asks[1]!.temperature, 0.1)
  assert.ok(llm.asks[1]!.user.length <= llm.asks[0]!.user.length, 'the second try is no longer than the first')
  assert.equal(brief.kind, 'unwritable')
  if (brief.kind !== 'unwritable') return
  assert.equal(brief.sources.length, 1, 'one sentence per account')
  assert.equal(brief.sources[0]!.company, 'Stripe SWE onsite')
})

test('an account with no sentence worth quoting is never briefed', async () => {
  const llm = new Scripted()
  const short: Account = { ...ACCOUNTS[0]!, text: 'Four rounds. Debugging was hard. Good luck.' }
  const brief = await briefInterview(llm, 'Stripe', [short], NOW)
  assert.equal(llm.asks.length, 0, 'the model is never asked with nothing to cite')
  assert.deepEqual(brief, { kind: 'unwritable', sources: [] })
})

test('a chip reads as the account, with the board as the small print', async () => {
  const llm = new Scripted()
  llm.queue.push('Four rounds in a day. [S:leetcode:1#0] And that is the shape of it, more or less.')
  const brief = await briefInterview(llm, 'Stripe', ACCOUNTS, NOW)
  assert.equal(brief.kind, 'brief')
  if (brief.kind !== 'brief') return
  assert.equal(brief.sources[0]!.company, 'Stripe SWE onsite')
  assert.equal(brief.sources[0]!.title, 'LeetCode discuss')
})

test('the prose closes over where a marker was, and one account is one chip', async () => {
  assert.equal(tidy('Two rounds of an hour each . Then a debugging round , . Done .'), 'Two rounds of an hour each. Then a debugging round. Done.')
  const llm = new Scripted()
  llm.queue.push('Four rounds. [S:leetcode:1#0] A real codebase to fix. [S:leetcode:1#1] That is the shape of it.')
  const brief = await briefInterview(llm, 'Stripe', ACCOUNTS, NOW)
  assert.equal(brief.kind, 'brief')
  if (brief.kind !== 'brief') return
  // "That is the shape of it" cites nothing, so it is not part of the brief.
  assert.equal(brief.text, 'Four rounds. A real codebase to fix.')
  assert.deepEqual(brief.citations, ['leetcode:1#0', 'leetcode:1#1'])
  assert.equal(brief.sources.length, 1)
})

test('a brief that cites nothing is not shown as if it were sourced', async () => {
  const llm = new Scripted()
  llm.queue.push('Four rounds in a day, and a debugging round people found hard.', 'Still nothing to point at, but it sounds hard.')
  const brief = await briefInterview(llm, 'Stripe', ACCOUNTS, NOW)
  assert.equal(llm.asks.length, 2, 'it is tried again before being given up on')
  assert.equal(brief.kind, 'unwritable')
})

test('a reply that ran out of room is cut back to the last finished sentence', () => {
  assert.equal(
    tidy('Four rounds over one day. The debugging round is the hard one. They also ask about'),
    'Four rounds over one day. The debugging round is the hard one.'
  )
  assert.equal(tidy('Four rounds over one day.'), 'Four rounds over one day.')
  assert.equal(tidy('no punctuation at all here'), 'no punctuation at all here')
})

test('what counts as fallen apart', () => {
  assert.ok(degenerate('Interview!!!!!!!!!!!!!!!!!!!!!'))
  assert.ok(degenerate('ok'))
  assert.ok(degenerate('!!! ??? ... --- ,,, ;;; ::: ***'))
  assert.ok(!degenerate('The onsite was four rounds over one day and the debugging round was the hard one.'))
})

test('a period inside a number or an abbreviation is not the end of a sentence', () => {
  assert.equal(
    tidy('The onsite runs four rounds in one day. People mention e.g. a debugging round that most found harder than the'),
    'The onsite runs four rounds in one day.'
  )
  assert.equal(
    tidy('The screen took roughly 2.5 hours in total. They then went quiet for about'),
    'The screen took roughly 2.5 hours in total.'
  )
})

test('a first reply that cites nothing is replaced by a second that does', async () => {
  const llm = new Scripted()
  llm.queue.push('Four rounds, nothing to point at.', 'Four rounds over one day, and a debugging round. [S:leetcode:1#0]')
  const brief = await briefInterview(llm, 'Stripe', ACCOUNTS, NOW)
  assert.equal(brief.kind, 'brief')
  if (brief.kind !== 'brief') return
  assert.deepEqual(brief.citations, ['leetcode:1#0'])
})

test('one citation does not license the sentences around it', async () => {
  const llm = new Scripted()
  llm.queue.push(
    'Stripe pays 400k, always rejects new grads, and requires a PhD. The onsite was four rounds and the debugging round was the hard one. [S:leetcode:1#0] They also ask about system design.'
  )
  const brief = await briefInterview(llm, 'Stripe', ACCOUNTS, NOW)
  assert.equal(brief.kind, 'brief')
  if (brief.kind !== 'brief') return
  assert.equal(brief.text, 'The onsite was four rounds and the debugging round was the hard one.')
  assert.doesNotMatch(brief.text, /400k|PhD|new grads|system design/, 'a claim with no marker is not said')
  assert.deepEqual(brief.citations, ['leetcode:1#0'])
})

test('a marker the accounts cannot back does not carry the sentence it sits on', async () => {
  const llm = new Scripted()
  llm.queue.push(
    'The onsite was four rounds and the debugging round was the hard one. [S:leetcode:1#0] Everyone there works eighty hour weeks. [S:made-up]',
    'Nothing to point at here either.'
  )
  const brief = await briefInterview(llm, 'Stripe', ACCOUNTS, NOW)
  assert.equal(brief.kind, 'brief')
  if (brief.kind !== 'brief') return
  assert.doesNotMatch(brief.text, /eighty hour/)
})

test('a reply where only a stub survives the gate is not shown as a brief', async () => {
  const llm = new Scripted()
  // One cited fragment and a paragraph of invention leaves nothing worth reading.
  llm.queue.push('Yes. [S:leetcode:1#0] They pay 400k and reject everyone from a state school.', 'Still nothing to point at.')
  const brief = await briefInterview(llm, 'Stripe', ACCOUNTS, NOW)
  assert.equal(llm.asks.length, 2, 'it is tried again before being given up on')
  assert.equal(brief.kind, 'unwritable')
})

test('a claim is a sentence with the markers written after it', () => {
  assert.deepEqual(claims('Four rounds. [S:a] A real codebase. [S:b,c] Done.'), [
    'Four rounds. [S:a]',
    'A real codebase. [S:b,c]',
    'Done.'
  ])
  assert.deepEqual(claims('The screen ran 2.5 hours. Then silence.'), ['The screen ran 2.5 hours.', 'Then silence.'])
  assert.deepEqual(claims('- four rounds [S:a]\n- two hours each'), ['- four rounds [S:a]', '- two hours each'])
})

test('the brief says how old the accounts are, from the dates and not from the model', async () => {
  const llm = new Scripted()
  llm.queue.push('The onsite was four rounds and the debugging round was the hard one. [S:leetcode:1#0]')
  const stale = 1_800_000_000_000 + 86_400_000 * 541
  const brief = await briefInterview(llm, 'Stripe', ACCOUNTS, stale)
  assert.equal(brief.kind, 'brief')
  if (brief.kind !== 'brief') return
  assert.equal(
    brief.text,
    'This account is about a year and a half old. The onsite was four rounds and the debugging round was the hard one.'
  )
})

test('how old an account is, said the way a person says it', () => {
  assert.equal(ageOf(3), null, 'a fresh account needs no note')
  assert.equal(ageOf(179), null)
  assert.equal(ageOf(210), 'about 7 months old')
  assert.equal(ageOf(541), 'about a year and a half old')
  assert.equal(ageOf(730), 'about two years old')
  assert.equal(ageOf(900), 'about two and a half years old')
  assert.equal(ageOf(1400), 'over three years old')
})
