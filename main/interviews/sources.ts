import { htmlToText, splitSentences } from '../ikb/tag.ts'
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

export interface Account {
  id: string
  source: Source
  title: string
  text: string
  url: string
  /** When it was posted, milliseconds since the epoch. */
  at: number
}

export type Fetch = (url: string, init?: RequestInit) => Promise<Response>

/** Accounts older than this are not what a recent interview looked like. */
export const RECENT_MS = 365 * 24 * 60 * 60 * 1000

/** Enough to read across, few enough to fit a prompt. */
const MAX_ACCOUNTS = 12
const SENTENCES_PER_ACCOUNT = 8
const TIMEOUT_MS = 15000

function mentions(text: string, company: string): boolean {
  const escaped = company.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(?<![A-Za-z0-9])${escaped}(?![A-Za-z0-9])`, 'i').test(text)
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
    const seconds = Number(node.post?.creationDate)
    out.push({
      id: `leetcode:${node.id}`,
      source: 'leetcode',
      title: title || `${company} interview`,
      text,
      url: `https://leetcode.com/discuss/post/${node.id}/`,
      at: Number.isFinite(seconds) ? seconds * 1000 : 0
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
    if (/SEEKING (WORK|FREELANCER)/i.test(text)) continue
    if (!mentions(text, company) || !/\binterview/i.test(text)) continue
    const seconds = Number(hit.created_at_i)
    out.push({
      id: `hn:${hit.objectID}`,
      source: 'hn',
      title: typeof hit.story_title === 'string' && hit.story_title ? hit.story_title : 'Hacker News comment',
      text,
      url: `https://news.ycombinator.com/item?id=${hit.objectID}`,
      at: Number.isFinite(seconds) ? seconds * 1000 : 0
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
 * Everything the sources have from the last year, newest first. A source that
 * fails is skipped rather than failing the brief, and the brief says how many
 * accounts it had.
 */
export async function gather(company: string, fetchFn: Fetch = fetch, now = Date.now()): Promise<Account[]> {
  const settled = await Promise.allSettled([fetchLeetCode(company, fetchFn), fetchHn(company, fetchFn, now)])
  const accounts = settled.flatMap((result) => (result.status === 'fulfilled' ? result.value : []))
  return accounts
    .filter((account) => account.at >= now - RECENT_MS)
    .sort((a, b) => b.at - a.at)
    .slice(0, MAX_ACCOUNTS)
}

/** The accounts as sentences with ids, which is the only form the model may cite. */
export function sentencesOf(accounts: Account[]): Sentence[] {
  const out: Sentence[] = []
  for (const account of accounts) {
    const pieces = splitSentences(account.text).slice(0, SENTENCES_PER_ACCOUNT)
    pieces.forEach((text, index) => out.push({ id: `${account.id}#${index}`, postingId: account.id, text, tags: [] }))
  }
  return out
}
