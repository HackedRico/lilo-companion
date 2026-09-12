import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import MiniSearch from 'minisearch'
import type { Posting, Sentence } from '../../shared/types.ts'
import { buildMatchers, type Matcher, type Term } from './tag.ts'

export interface Ikb {
  postings: Map<string, Posting>
  sentences: Sentence[]
  /** Canonical term to every sentence carrying it. */
  byTag: Map<string, Sentence[]>
  /** Lowercased term or alias to the canonical term it stands for. */
  vocabulary: Map<string, string>
  practices: Set<string>
  matchers: Matcher[]
  search: MiniSearch<Sentence>
  /** Job titles, so a phrase like "quantitative finance" can find its family. */
  titles: MiniSearch<TitleDoc>
  postingCount: number
}

export interface TitleDoc {
  id: string
  title: string
  roleFamily: string
}

interface RawIkb {
  postings: Posting[]
  sentences: Sentence[]
}

const NOTHING: RawIkb = { postings: [], sentences: [] }

/**
 * A missing evidence base loads as an empty one rather than taking the app down
 * with it. Everything downstream reads through a map or an index, so empty is a
 * base that proves nothing, which is a state the companion already knows how to
 * be in. `npm run ingest` rebuilds it.
 */
export async function loadIkb(dataDir: string): Promise<Ikb> {
  const read = async <T>(name: string): Promise<T> =>
    JSON.parse(await readFile(join(dataDir, name), 'utf8')) as T

  const [raw, tools, practices] = await Promise.all([
    read<RawIkb>('ikb.json').catch(() => NOTHING),
    read<Term[]>('tools.json'),
    read<Term[]>('practices.json')
  ])

  const postings = new Map(raw.postings.map((posting) => [posting.id, posting]))

  const byTag = new Map<string, Sentence[]>()
  for (const sentence of raw.sentences) {
    for (const tag of sentence.tags) {
      const bucket = byTag.get(tag)
      if (bucket) bucket.push(sentence)
      else byTag.set(tag, [sentence])
    }
  }

  const vocabulary = new Map<string, string>()
  for (const { term, aliases } of [...tools, ...practices]) {
    for (const word of [term, ...aliases]) vocabulary.set(word.toLowerCase(), term)
  }

  const search = new MiniSearch<Sentence>({
    fields: ['text', 'tags'],
    storeFields: ['id', 'postingId', 'text', 'tags'],
    searchOptions: { boost: { tags: 2 }, fuzzy: 0.15, prefix: true }
  })
  search.addAll(raw.sentences)

  const titles = new MiniSearch<TitleDoc>({
    fields: ['title'],
    storeFields: ['id', 'title', 'roleFamily'],
    searchOptions: { fuzzy: 0.2, prefix: true }
  })
  titles.addAll(raw.postings.map((p) => ({ id: p.id, title: p.title, roleFamily: p.roleFamily })))

  return {
    postings,
    sentences: raw.sentences,
    byTag,
    vocabulary,
    practices: new Set(practices.map((practice) => practice.term)),
    matchers: buildMatchers([...tools, ...practices]),
    search,
    titles,
    postingCount: raw.postings.length
  }
}
