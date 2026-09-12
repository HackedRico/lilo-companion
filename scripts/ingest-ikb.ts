import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import {
  buildMatchers,
  classifyRole,
  classifySeniority,
  htmlToText,
  isBoilerplate,
  splitSentences,
  tagText,
  type Term
} from '../src/main/ikb/tag.ts'
import type { Posting, Sentence } from '../src/shared/types.ts'

/**
 * Pulls public ATS boards into one local file. No auth, no scraping: these are
 * the same endpoints the companies' own job pages call.
 */

interface Board {
  ats: 'greenhouse' | 'lever' | 'ashby'
  token: string
  company: string
}

/** One posting should not be able to flood the evidence for a term. */
const SENTENCES_PER_POSTING = 12
const POSTINGS_PER_BOARD = 80
const TIMEOUT_MS = 30000

const root = resolve(import.meta.dirname, '..')

async function readJson<T>(name: string): Promise<T> {
  return JSON.parse(await readFile(resolve(root, 'data', name), 'utf8')) as T
}

async function getJson(url: string): Promise<unknown> {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { accept: 'application/json' }
  })
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`)
  return response.json()
}

interface RawPosting {
  id: string
  title: string
  url: string
  text: string
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

async function fetchBoard(board: Board): Promise<RawPosting[]> {
  if (board.ats === 'greenhouse') {
    const body = (await getJson(
      `https://boards-api.greenhouse.io/v1/boards/${board.token}/jobs?content=true`
    )) as { jobs?: unknown }
    return asArray(body.jobs).map((job) => {
      const j = job as Record<string, unknown>
      return {
        id: String(j['id']),
        title: str(j['title']),
        url: str(j['absolute_url']),
        text: htmlToText(str(j['content']))
      }
    })
  }

  if (board.ats === 'ashby') {
    const body = (await getJson(
      `https://api.ashbyhq.com/posting-api/job-board/${board.token}`
    )) as { jobs?: unknown }
    return asArray(body.jobs).map((job) => {
      const j = job as Record<string, unknown>
      const plain = str(j['descriptionPlain'])
      return {
        id: str(j['id']),
        title: str(j['title']),
        url: str(j['jobUrl']),
        text: plain || htmlToText(str(j['descriptionHtml']))
      }
    })
  }

  const body = await getJson(`https://api.lever.co/v0/postings/${board.token}?mode=json`)
  return asArray(body).map((job) => {
    const j = job as Record<string, unknown>
    // The bullet lists carry the requirements; `additional` is company boilerplate.
    const lists = asArray(j['lists'])
      .map((list) => htmlToText(str((list as Record<string, unknown>)['content'])))
      .join('\n')
    return {
      id: str(j['id']),
      title: str(j['text']),
      url: str(j['hostedUrl']),
      text: [str(j['descriptionPlain']), lists].filter(Boolean).join('\n')
    }
  })
}

async function main(): Promise<void> {
  const [boards, tools, practices] = await Promise.all([
    readJson<Board[]>('boards.json'),
    readJson<Term[]>('tools.json'),
    readJson<Term[]>('practices.json')
  ])
  const matchers = buildMatchers([...tools, ...practices])
  const practiceTerms = new Set(practices.map((p) => p.term))

  const postings: Posting[] = []
  const sentences: Sentence[] = []
  const failed: string[] = []

  for (const board of boards) {
    let raw: RawPosting[]
    try {
      raw = await fetchBoard(board)
    } catch (error) {
      failed.push(`${board.company} (${(error as Error).message})`)
      continue
    }

    let kept = 0
    for (const job of raw.slice(0, POSTINGS_PER_BOARD)) {
      if (!job.title || !job.text) continue
      const postingId = `${board.ats}:${board.token}:${job.id}`
      const tagged: Sentence[] = []

      for (const text of splitSentences(job.text)) {
        if (tagged.length >= SENTENCES_PER_POSTING) break
        if (isBoilerplate(text)) continue
        const tags = tagText(text, matchers)
        if (tags.length === 0) continue
        tagged.push({ id: `${postingId}#${tagged.length}`, postingId, text, tags })
      }

      // A posting with nothing to say about tools or practices is not evidence.
      if (tagged.length === 0) continue

      postings.push({
        id: postingId,
        company: board.company,
        title: job.title,
        roleFamily: classifyRole(job.title),
        seniority: classifySeniority(job.title),
        url: job.url
      })
      sentences.push(...tagged)
      kept++
    }
    process.stdout.write(`${board.company.padEnd(12)} ${String(kept).padStart(3)} postings\n`)
  }

  const practiceHits = sentences.filter((s) => s.tags.some((t) => practiceTerms.has(t))).length
  await writeFile(
    resolve(root, 'data', 'ikb.json'),
    JSON.stringify({ postings, sentences }) + '\n'
  )

  process.stdout.write(
    `\n${postings.length} postings, ${sentences.length} sentences, ${practiceHits} mention a practice\n`
  )
  if (failed.length) process.stdout.write(`skipped: ${failed.join(', ')}\n`)
}

await main()
