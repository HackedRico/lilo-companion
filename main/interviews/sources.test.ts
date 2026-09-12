import assert from 'node:assert/strict'
import { test } from 'node:test'
import { RECENT_MS, aboutInterviewingAt, dateOf, fetchHn, gather, parseHn, parseLeetCode, sentencesOf, type Fetch } from './sources.ts'

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
    { objectID: '4', comment_text: 'My Coinbase interview was fine.', created_at_i: Math.floor(NOW / 1000) },
    {
      objectID: '5',
      story_title: 'Ask HN: Who is hiring? (March 2026)',
      comment_text: 'Acme | Senior Engineer | Remote. We use Stripe. Interview is two rounds.',
      created_at_i: Math.floor(NOW / 1000)
    },
    {
      objectID: '6',
      comment_text: `Kickstarter got dropped by Stripe over policy. ${'Lorem ipsum dolor sit amet. '.repeat(20)} Anyway my interview elsewhere went fine.`,
      created_at_i: Math.floor(NOW / 1000)
    }
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

test('hacker news keeps comments about interviewing there, and drops adverts, hiring threads and far-apart mentions', () => {
  const accounts = parseHn(hn, 'Stripe')
  assert.deepEqual(accounts.map((account) => account.id), ['hn:1'])
  assert.equal(accounts[0]!.text, "Stripe's interview was four rounds and the debugging one was the hard part of it for me.")
  assert.equal(accounts[0]!.title, 'Ask HN: Interview loops')
})

test('gathering skips a source that fails, and reads back further only when the last year is thin', async () => {
  const older = { objectID: '9', comment_text: 'Stripe interview two years back: three rounds.', created_at_i: Math.floor((NOW - 2 * RECENT_MS) / 1000) }
  const ancient = { objectID: '10', comment_text: 'Stripe interview in another age.', created_at_i: Math.floor((NOW - 4 * RECENT_MS) / 1000) }
  const fetchFn: Fetch = async (url) => {
    if (url.includes('leetcode.com')) throw new Error('down')
    return new Response(JSON.stringify({ hits: [...hn.hits, older, ancient] }), { status: 200 })
  }
  const accounts = await gather('Stripe', fetchFn, NOW)
  assert.deepEqual(accounts.map((account) => account.id), ['hn:1', 'hn:9'], 'one recent account is thin, so the two year old one is read too, and the four year old one is not')

  const plenty: Fetch = async () => {
    const recent = [1, 2, 3, 4].map((n) => ({ objectID: `r${n}`, comment_text: `Stripe interview number ${n} was three rounds.`, created_at_i: Math.floor((NOW - n * day) / 1000) }))
    return new Response(JSON.stringify({ hits: [...recent, older] }), { status: 200 })
  }
  const enough = await gather('Stripe', plenty, NOW)
  assert.ok(!enough.some((account) => account.id === 'hn:9'), 'with enough recent accounts, older ones stay out')
})

test('a date arrives as seconds, milliseconds or a string, and an account with none is not read', () => {
  assert.equal(dateOf(1_700_000_000), 1_700_000_000_000)
  assert.equal(dateOf(1_700_000_000_000), 1_700_000_000_000)
  assert.equal(dateOf('1700000000'), 1_700_000_000_000)
  assert.equal(dateOf('2025-09-01T10:00:00Z'), Date.parse('2025-09-01T10:00:00Z'))
  assert.equal(dateOf(undefined), null)
  assert.equal(dateOf('soon'), null)
  const undated = { data: { categoryTopicList: { edges: [{ node: { id: 1, title: 'Stripe onsite', post: { content: 'Stripe interview.' } } }] } } }
  assert.deepEqual(parseLeetCode(undated, 'Stripe'), [])
})

test('every board failing is an error, not an empty answer to be believed', async () => {
  const down: Fetch = async () => {
    throw new Error('offline')
  }
  await assert.rejects(gather('Stripe', down, NOW), /none of the boards answered/)
})

test('the company has to be named near the word interview', () => {
  assert.ok(aboutInterviewingAt('My Stripe interview was four rounds.', 'Stripe'))
  assert.ok(!aboutInterviewingAt(`Stripe dropped us. ${'x '.repeat(300)} My interview elsewhere.`, 'Stripe'))
  assert.ok(!aboutInterviewingAt('Stripe is a payments company.', 'Stripe'))
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

test('accounts become sentences with ids that point back at the account, capped by size', () => {
  const sentences = sentencesOf(parseLeetCode(leetcode, 'Stripe'))
  assert.ok(sentences.length >= 2)
  assert.ok(sentences.every((sentence) => sentence.id.startsWith('leetcode:5984403#')))
  assert.ok(sentences.every((sentence) => sentence.postingId === 'leetcode:5984403'))
  assert.equal(sentencesOf(parseLeetCode(leetcode, 'Stripe'), 100).length, 1, 'a small cap keeps one sentence')
})
