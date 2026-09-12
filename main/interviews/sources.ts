import { z } from 'zod'
import { escapeRegExp, htmlToText, splitSentences } from '../ikb/tag.ts'
import type { Sentence } from '../../shared/types.ts'

/**
 * First-hand accounts of interviewing at a company, from places that publish
 * them without a login: LeetCode's interview experience board and Hacker
 * News comments. Reddit and Glassdoor want a key or block the request, so
 * they are not read. Fetching is separate from parsing, so a fixture tests
 * the parsing and a fake fetch tests the gathering.
 */

export type Source = 'leetcode' | 'hn'

export const SOURCE_LABEL: Record<Source, string> = {
  leetcode: 'LeetCode discuss',
  hn: 'Hacker News'
}

/** An account as it is kept on disk, so a cache file is checked before it is believed. */
export const account = z.object({
  id: z.string().min(1),
  source: z.enum(['leetcode', 'hn']),
  title: z.string(),
  text: z.string(),
  url: z.string().url(),
  /** When it was posted, milliseconds since the epoch. */
  at: z.number().positive()
})

export type Account = z.infer<typeof account>

export type Fetch = (url: string, init?: RequestInit) => Promise<Response>

/** Accounts older than this are not what a recent interview looked like. */
export const RECENT_MS = 365 * 24 * 60 * 60 * 1000
/** With too few recent ones, older accounts are read too, and the brief says how old. */
const STALE_MS = 3 * RECENT_MS
const ENOUGH_RECENT = 4

/** Enough to read across, few enough that a small model keeps its head. */
const MAX_ACCOUNTS = 8
const SENTENCES_PER_ACCOUNT = 6
const MAX_PROMPT_CHARS = 6000
const TIMEOUT_MS = 15000

/** Threads where a company is named because someone is hiring or wants hiring, not interviewing. */
const NOT_AN_ACCOUNT = /who is hiring|who wants to be hired|seeking (work|freelancer)|freelancer\?/i

function pattern(company: string): RegExp {
  return new RegExp(`(?<![A-Za-z0-9_-])${escapeRegExp(company)}(?![A-Za-z0-9_-])`, 'gi')
}

function mentions(text: string, company: string): boolean {
  return pattern(company).test(text)
}

/**
 * Seconds, milliseconds or a date string, whichever the board sends, as
 * milliseconds. Null when it is none of those: an account with no date
 * cannot be called recent, so it is not read.
 */
export function dateOf(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value > 1e12 ? value : value * 1000
  if (typeof value === 'string') {
    const asNumber = Number(value)
    if (Number.isFinite(asNumber) && asNumber > 0) return dateOf(asNumber)
    const parsed = Date.parse(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

/** The words of an interview loop, as opposed to an interview on a podcast. */
const LOOP = /\b(onsite|on-site|phone screen|screening|coding (round|interview|challenge)|system design|technical interview|interview loop|rounds?|recruiter|hiring process|offer|rejected|take-?home)\b/gi

/**
 * Whether the comment is about interviewing at the company: the company
 * named as the interviewer ("interviewed at Stripe", "Stripe's onsite"), or
 * named near the words of an interview loop. "An interview with Stripe's
 * CEO on a podcast" is neither.
 */
export function aboutInterviewingAt(text: string, company: string, within = 200): boolean {
  const name = escapeRegExp(company)
  if (new RegExp(`\\binterview(?:ed|ing|s)?\\s+(?:at|with|for)\\s+${name}\\b`, 'i').test(text)) return true
  if (new RegExp(`\\b${name}(?:'s)?\\s+(?:interview|onsite|on-site|phone screen|loop|hiring process)`, 'i').test(text)) return true
  const loops = [...text.matchAll(LOOP)].map((match) => match.index ?? 0)
  if (loops.length === 0) return false
  for (const match of text.matchAll(pattern(company))) {
    const at = match.index ?? 0
    if (loops.some((index) => Math.abs(index - at) <= within)) return true
  }
  return false
}

/** Enough markdown stripping that a sentence reads as prose. */
function plain(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_`#>]+/g, '')
    .replace(/\\n/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .trim()
}

interface LeetCodeTopic {
  id?: unknown
  title?: unknown
  post?: { content?: unknown; creationDate?: unknown }
}

/** The interview experience board, newest first, kept where the title or body names the company. */
export function parseLeetCode(body: unknown, company: string): Account[] {
  const edges = (body as { data?: { categoryTopicList?: { edges?: unknown[] } } })?.data?.categoryTopicList?.edges
  if (!Array.isArray(edges)) return []
  const out: Account[] = []
  for (const edge of edges) {
    const node = (edge as { node?: LeetCodeTopic })?.node
    if (!node || typeof node.id !== 'string' && typeof node.id !== 'number') continue
    const title = typeof node.title === 'string' ? node.title : ''
    const text = plain(typeof node.post?.content === 'string' ? node.post.content : '')
    if (!mentions(`${title}\n${text.slice(0, 300)}`, company)) continue
    const at = dateOf(node.post?.creationDate)
    if (at === null) continue
    out.push({
      id: `leetcode:${node.id}`,
      source: 'leetcode',
      title: title || `${company} interview`,
      text,
      url: `https://leetcode.com/discuss/post/${node.id}/`,
      at
    })
  }
  return out
}

interface HnHit {
  objectID?: unknown
  comment_text?: unknown
  story_title?: unknown
  created_at_i?: unknown
}

/** Comments that talk about interviewing at the company, and are not someone advertising. */
export function parseHn(body: unknown, company: string): Account[] {
  const hits = (body as { hits?: unknown[] })?.hits
  if (!Array.isArray(hits)) return []
  const out: Account[] = []
  for (const raw of hits) {
    const hit = raw as HnHit
    if (typeof hit.objectID !== 'string' || typeof hit.comment_text !== 'string') continue
    const text = htmlToText(hit.comment_text)
    const story = typeof hit.story_title === 'string' ? hit.story_title : ''
    if (NOT_AN_ACCOUNT.test(text) || NOT_AN_ACCOUNT.test(story)) continue
    if (!aboutInterviewingAt(text, company)) continue
    const at = dateOf(hit.created_at_i)
    if (at === null) continue
    out.push({
      id: `hn:${hit.objectID}`,
      source: 'hn',
      title: story || 'Hacker News comment',
      text,
      url: `https://news.ycombinator.com/item?id=${hit.objectID}`,
      at
    })
  }
  return out
}

async function getJson(fetchFn: Fetch, url: string, init: RequestInit = {}): Promise<unknown> {
  const response = await fetchFn(url, {
    ...init,
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { accept: 'application/json', 'user-agent': 'Mozilla/5.0 lilo-companion', ...(init.headers ?? {}) }
  })
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`)
  return response.json()
}

export async function fetchLeetCode(company: string, fetchFn: Fetch): Promise<Account[]> {
  const body = await getJson(fetchFn, 'https://leetcode.com/graphql', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      operationName: 'categoryTopicList',
      variables: { categories: ['interview-experience'], orderBy: 'newest_to_oldest', query: company, first: 20 },
      query:
        'query categoryTopicList($categories: [String!]!, $first: Int!, $orderBy: TopicSortingOption, $query: String) { categoryTopicList(categories: $categories, orderBy: $orderBy, query: $query, first: $first) { edges { node { id title post { content creationDate } } } } }'
    })
  })
  return parseLeetCode(body, company)
}

export async function fetchHn(company: string, fetchFn: Fetch, now = Date.now()): Promise<Account[]> {
  const since = Math.floor((now - RECENT_MS) / 1000)
  const query = encodeURIComponent(`"${company}" interview`)
  const body = await getJson(
    fetchFn,
    `https://hn.algolia.com/api/v1/search_by_date?query=${query}&tags=comment&numericFilters=created_at_i%3E${since}&hitsPerPage=30`
  )
  return parseHn(body, company)
}

/**
 * What the sources have. A write-up on the interview experience board is
 * first-hand by construction and is read back to three years; a comment on
 * Hacker News is read from the last year, and older only when the last year
 * is thin. Write-ups come first, then newest first, and the brief says how
 * old they are. One source failing is skipped; every source failing throws,
 * so an outage is never mistaken for a company nobody has written about.
 */
export async function gather(company: string, fetchFn: Fetch = fetch, now = Date.now()): Promise<Account[]> {
  const settled = await Promise.allSettled([fetchLeetCode(company, fetchFn), fetchHn(company, fetchFn, now)])
  if (settled.every((result) => result.status === 'rejected')) {
    throw new Error('none of the boards answered')
  }
  const accounts = settled
    .flatMap((result) => (result.status === 'fulfilled' ? result.value : []))
    .filter((account) => account.at >= now - STALE_MS)
  const writeUps = accounts.filter((account) => account.source === 'leetcode')
  const comments = accounts.filter((account) => account.source === 'hn')
  const recentComments = comments.filter((account) => account.at >= now - RECENT_MS)
  const chosen = [...writeUps, ...(writeUps.length + recentComments.length >= ENOUGH_RECENT ? recentComments : comments)]
  return chosen
    .sort((a, b) => (a.source === b.source ? b.at - a.at : a.source === 'leetcode' ? -1 : 1))
    .slice(0, MAX_ACCOUNTS)
}

/**
 * The accounts as sentences with ids, which is the only form the model may
 * cite. Capped by characters as well as count, because a small model handed
 * a long prompt stops answering and starts repeating.
 */
export function sentencesOf(accounts: Account[], maxChars = MAX_PROMPT_CHARS): Sentence[] {
  const out: Sentence[] = []
  let used = 0
  for (const account of accounts) {
    const pieces = splitSentences(account.text).slice(0, SENTENCES_PER_ACCOUNT)
    for (const [index, text] of pieces.entries()) {
      if (used + text.length > maxChars) return out
      used += text.length
      out.push({ id: `${account.id}#${index}`, postingId: account.id, text, tags: [] })
    }
  }
  return out
}
