import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { ZodType } from 'zod'
import type { Ask, LlmLike } from '../llm/service.ts'
import { briefInterview } from './brief.ts'
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

class Scripted implements LlmLike {
  readonly available = true
  asks: Ask[] = []
  async json<T>(_schema: ZodType<T>): Promise<T> {
    throw new Error('not used')
  }
  async text(): Promise<string> {
    throw new Error('not used')
  }
  async stream(ask: Ask, onToken: (token: string) => void): Promise<string> {
    this.asks.push(ask)
    const text = 'Four rounds in a day. [S:leetcode:1#0] Bring a debugger. [S:made-up] Done.'
    for (const token of text.split(' ')) onToken(`${token} `)
    return text
  }
}

test('a claim keeps only the citations the accounts can back, and the sources point at them', async () => {
  const llm = new Scripted()
  let said = ''
  const brief = await briefInterview(llm, 'Stripe', ACCOUNTS, (token) => (said += token), 1_800_000_000_000 + 86_400_000 * 3)
  assert.doesNotMatch(said, /\[S:/, 'markers never reach the student')
  assert.deepEqual(brief.citations, ['leetcode:1#0'])
  assert.equal(brief.sources.length, 1)
  assert.equal(brief.sources[0]!.company, 'LeetCode discuss')
  assert.equal(brief.sources[0]!.url, 'https://leetcode.com/discuss/post/1/')
  assert.match(llm.asks[0]!.user, /\[S:leetcode:1#0\] The onsite was four rounds/)
  assert.match(llm.asks[0]!.system, /1 first-hand account people posted publicly, posted between 3 and 3 days ago/)
})
