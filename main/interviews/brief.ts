import type { Evidence, Sentence } from '../../shared/types.ts'
import { interviewBrief } from '../../shared/prompts.ts'
import type { LlmLike } from '../llm/service.ts'
import { CitationFilter } from '../chat/citations.ts'
import { SOURCE_LABEL, sentencesOf, type Account } from './sources.ts'

export type Brief =
  | { kind: 'brief'; text: string; citations: string[]; sources: Evidence[] }
  /** The model could not put the accounts into words. The accounts are still worth handing over. */
  | { kind: 'unwritable'; sources: Evidence[] }

/**
 * A reply that has stopped answering: a run of one character, or too few
 * words to be a brief. A small model does this on a long prompt, and it is
 * better caught here than shown.
 */
export function degenerate(text: string): boolean {
  const words = text.trim().split(/\s+/).filter(Boolean)
  return words.length < 4 || /(.)\1{11,}/.test(text) || !/[a-z]{3}/i.test(text)
}

/** The chip reads as the account, so six citations are six different chips, and the source is the small print. */
/** A marker pulled out of a sentence leaves a gap before the full stop; the prose closes over it. */
export function tidy(text: string): string {
  const closed = text
    .replace(/\s+([.,;:!?])/g, '$1')
    .replace(/,\s*([.;:!?])/g, '$1')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
  if (/[.!?]["')\]]?$/.test(closed)) return closed
  // The reply ran out of room mid-sentence. Half a sentence reads as a bug, so
  // it is cut back to the last one that finished. A period inside a number, an
  // initial or "e.g." is not one, so the end has to be a capital or nothing.
  let end = -1
  for (const match of closed.matchAll(/[.!?]["')\]]?\s+(?=[A-Z])/g)) {
    const at = (match.index ?? 0) + match[0].trimEnd().length
    const before = closed.slice(Math.max(0, at - 4), at - 1)
    if (/\d$/.test(before) || /\b[a-z]$/.test(before) || /\b(e\.g|i\.e|etc|vs|Mr|Dr)$/i.test(before)) continue
    end = at
  }
  // Long enough to read as a sentence rather than a stub.
  return end > 24 ? closed.slice(0, end) : closed
}

function evidenceOf(sentence: Sentence, account: Account): Evidence {
  return { sentence, company: account.title.slice(0, 60), title: SOURCE_LABEL[account.source], url: account.url }
}

/**
 * What a recent interview at the company looked like, said from the accounts
 * and nothing else. The same gate as companion chat: a citation survives only
 * where the retriever returned it, and here the retriever is the account list.
 * The reply arrives whole rather than streamed, so a reply that fell apart is
 * retried on a shorter prompt and never shown.
 */
export async function briefInterview(
  llm: LlmLike,
  company: string,
  accounts: Account[],
  now = Date.now()
): Promise<Brief> {
  const byId = new Map(accounts.map((account) => [account.id, account]))
  const dates = accounts.map((account) => account.at)
  const span = {
    accounts: accounts.length,
    newestDaysAgo: Math.round((now - Math.max(...dates)) / 86400000),
    oldestDaysAgo: Math.round((now - Math.min(...dates)) / 86400000)
  }

  const attempt = async (sentences: Sentence[], temperature: number): Promise<Brief | null> => {
    const raw = await llm.text({
      lane: 'strong',
      temperature,
      maxTokens: 700,
      ...interviewBrief({ company, sentences, ...span })
    })
    if (degenerate(raw)) return null
    const filter = new CitationFilter(new Set(sentences.map((sentence) => sentence.id)))
    const text = tidy(`${filter.push(raw)}${filter.flush()}`)
    // Prose about an interview with nothing behind it is the one thing this
    // must not write, so it counts as a reply that did not work out.
    if (filter.citations.length === 0) return null
    const cited = new Set(filter.citations)
    // One chip per account: two sentences from one write-up are one place to go.
    const seen = new Set<string>()
    const sources = sentences
      .filter((sentence) => cited.has(sentence.id) && !seen.has(sentence.postingId) && seen.add(sentence.postingId))
      .map((sentence) => evidenceOf(sentence, byId.get(sentence.postingId)!))
    return { kind: 'brief', text, citations: filter.citations, sources }
  }

  const sentences = sentencesOf(accounts)
  // An account with no sentence worth quoting gives the model nothing to cite,
  // and a brief with nothing to cite is the one thing this must never write.
  if (sentences.length === 0) return { kind: 'unwritable', sources: [] }
  const first = await attempt(sentences, 0.3)
  if (first) return first
  const second = await attempt(sentences.slice(0, Math.max(6, Math.floor(sentences.length / 2))), 0.1)
  if (second) return second

  return { kind: 'unwritable', sources: firstSentences(accounts) }
}

/** One sentence per account, so the student can still read what was read. */
export function firstSentences(accounts: Account[]): Evidence[] {
  const byId = new Map(accounts.map((account) => [account.id, account]))
  const seen = new Set<string>()
  return sentencesOf(accounts)
    .filter((sentence) => !seen.has(sentence.postingId) && seen.add(sentence.postingId))
    .map((sentence) => evidenceOf(sentence, byId.get(sentence.postingId)!))
}
