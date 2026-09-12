import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import MiniSearch from 'minisearch'
import type { Posting, Sentence } from '../../shared/types.ts'
import { buildTaxonomy, type ConceptMapRule, type TaxonomyEntry } from './map.ts'
import { buildMatchers, type Matcher, type Term } from './tag.ts'

export interface Ikb {
  postings: Map<string, Posting>
  sentences: Sentence[]
  /** Canonical term to every sentence carrying it. */
  byTag: Map<string, Sentence[]>
  /**
   * Canonical term to how many distinct postings carry it. The companion says
   * this number out loud as a count of postings, and one posting often has
   * several sentences on the same term, so counting sentences overstated it.
   */
  postingsByTag: Map<string, number>
  /** Lowercased term or alias to the canonical term it stands for. */
  vocabulary: Map<string, string>
  /** Canonical tool and practice entries, normalized into one taxonomy. */
  taxonomy: Map<string, TaxonomyEntry>
  tools: Set<string>
  practices: Set<string>
  /** Academic/coursework phrases and the posting terms they usually map to. */
  conceptMappings: ConceptMapRule[]
  matchers: Matcher[]
  search: MiniSearch<Sentence>
  /** Job titles, so a phrase like "distributed systems" can find its track. */
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
  const conceptMappings = await read<ConceptMapRule[]>('concept-mappings.json').catch(() => [])

  const postings = new Map(raw.postings.map((posting) => [posting.id, posting]))

  const byTag = new Map<string, Sentence[]>()
  const postingIdsByTag = new Map<string, Set<string>>()
  for (const sentence of raw.sentences) {
    for (const tag of sentence.tags) {
      const bucket = byTag.get(tag)
      if (bucket) bucket.push(sentence)
      else byTag.set(tag, [sentence])
      const seen = postingIdsByTag.get(tag)
      if (seen) seen.add(sentence.postingId)
      else postingIdsByTag.set(tag, new Set([sentence.postingId]))
    }
  }
  const postingsByTag = new Map([...postingIdsByTag].map(([tag, ids]) => [tag, ids.size]))

  const vocabulary = new Map<string, string>()
  for (const { term, aliases } of [...tools, ...practices]) {
    for (const word of [term, ...aliases]) vocabulary.set(word.toLowerCase(), term)
  }
  const taxonomy = buildTaxonomy(tools, practices)

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
    postingsByTag,
    vocabulary,
    taxonomy,
    tools: new Set(tools.map((tool) => tool.term)),
    practices: new Set(practices.map((practice) => practice.term)),
    conceptMappings,
    matchers: buildMatchers([...tools, ...practices]),
    search,
    titles,
    postingCount: raw.postings.length
  }
}
