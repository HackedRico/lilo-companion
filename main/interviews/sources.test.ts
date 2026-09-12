import assert from 'node:assert/strict'
import { test } from 'node:test'
import { RECENT_MS, fetchHn, gather, parseHn, parseLeetCode, sentencesOf, type Fetch } from './sources.ts'

const NOW = 1_800_000_000_000
const day = 86_400_000

const leetcode = {
  data: {
    categoryTopicList: {
      edges: [
        {
          node: {
            id: 5984403,
            title: 'Stripe Sr. MLE onsite - Sept 2024',
            post: {
              content:
                'Sharing my onsite interview experience. Hope it helps someone :)\\n\\n**Screen** - first week of the month - 2 rounds of 1 hour each, one coding and one system design. The coding round was a debugging exercise in a real codebase rather than a puzzle.',
              creationDate: Math.floor((NOW - 30 * day) / 1000)
            }
          }
        },
        {
          node: {
            id: 6136427,
            title: 'LinkedIn | From constant rejections to an offer',
            post: { content: 'Interview at: LinkedIn. Role: SSE.', creationDate: Math.floor((NOW - 10 * day) / 1000) }
          }
        }
      ]
    }
  }
}

const hn = {
  hits: [
    {
      objectID: '1',
      story_title: 'Ask HN: Interview loops',
      comment_text: 'Stripe&#x27;s interview was four rounds and the debugging one was <i>the</i> hard part of it for me.',
      created_at_i: Math.floor((NOW - 5 * day) / 1000)
    },
    { objectID: '2', comment_text: 'SEEKING WORK | Remote. I once did a Stripe interview.', created_at_i: Math.floor(NOW / 1000) },
    { objectID: '3', comment_text: 'Stripe is a payments company with a good API.', created_at_i: Math.floor(NOW / 1000) },
    { objectID: '4', comment_text: 'My Coinbase interview was fine.', created_at_i: Math.floor(NOW / 1000) }
  ]
}

test('the discuss board keeps only the topics that name the company', () => {
  const accounts = parseLeetCode(leetcode, 'Stripe')
  assert.equal(accounts.length, 1)
  assert.equal(accounts[0]!.id, 'leetcode:5984403')
  assert.equal(accounts[0]!.url, 'https://leetcode.com/discuss/post/5984403/')
  assert.match(accounts[0]!.text, /^Sharing my onsite interview experience/)
  assert.doesNotMatch(accounts[0]!.text, /\*\*/, 'markdown is stripped')
  assert.equal(accounts[0]!.at, NOW - 30 * day)
})

test('hacker news keeps comments about interviewing there, and drops adverts and other companies', () => {
  const accounts = parseHn(hn, 'Stripe')
  assert.deepEqual(accounts.map((account) => account.id), ['hn:1'])
  assert.equal(accounts[0]!.text, "Stripe's interview was four rounds and the debugging one was the hard part of it for me.")
  assert.equal(accounts[0]!.title, 'Ask HN: Interview loops')
})

test('gathering skips a source that fails and keeps the last year, newest first', async () => {
  const fetchFn: Fetch = async (url) => {
    if (url.includes('leetcode.com')) throw new Error('down')
    const old = { objectID: '9', comment_text: 'Stripe interview, years ago.', created_at_i: Math.floor((NOW - 2 * RECENT_MS) / 1000) }
    return new Response(JSON.stringify({ hits: [...hn.hits, old] }), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  const accounts = await gather('Stripe', fetchFn, NOW)
  assert.deepEqual(accounts.map((account) => account.id), ['hn:1'])
})

test('the hacker news query asks for the last year by date', async () => {
  let asked = ''
  const fetchFn: Fetch = async (url) => {
    asked = url
    return new Response('{"hits":[]}', { status: 200 })
  }
  await fetchHn('Stripe', fetchFn, NOW)
  assert.match(asked, /search_by_date\?query=%22Stripe%22%20interview/)
  assert.match(asked, new RegExp(`created_at_i%3E${Math.floor((NOW - RECENT_MS) / 1000)}`))
})

test('accounts become sentences with ids that point back at the account', () => {
  const sentences = sentencesOf(parseLeetCode(leetcode, 'Stripe'))
  assert.ok(sentences.length >= 2)
  assert.ok(sentences.every((sentence) => sentence.id.startsWith('leetcode:5984403#')))
  assert.ok(sentences.every((sentence) => sentence.postingId === 'leetcode:5984403'))
})
