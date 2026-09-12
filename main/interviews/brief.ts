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

/** A full stop inside a number, an initial or "e.g." ends an abbreviation, not a sentence. */
function endsSentence(text: string, at: number): boolean {
  const before = text.slice(Math.max(0, at - 4), at - 1)
  return !/\d$/.test(before) && !/\b[a-z]$/.test(before) && !/\b(e\.g|i\.e|etc|vs|Mr|Dr)$/i.test(before)
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
    if (endsSentence(closed, at)) end = at
  }
  // Long enough to read as a sentence rather than a stub.
  return end > 24 ? closed.slice(0, end) : closed
}

/** The model writes the marker after the claim it backs, so a marker belongs to the sentence in front of it. */
const AFTER_THE_CLAIM = /^(?:\s*\[S:[^\]]*\])+/

/**
 * The reply as separate claims: one sentence each, carrying the markers
 * written after it. Cut this way, a claim can be checked on its own citation,
 * so the one id the model got right cannot vouch for the four sentences
 * around it.
 */
export function claims(text: string): string[] {
  const out: string[] = []
  let from = 0
  for (const match of text.matchAll(/[.!?]["')\]]?(?=\s)|\n/g)) {
    const at = (match.index ?? 0) + match[0].length
    if (at <= from || !endsSentence(text, at)) continue
    const end = at + (AFTER_THE_CLAIM.exec(text.slice(at))?.[0].length ?? 0)
    out.push(text.slice(from, end))
    from = end
  }
  out.push(text.slice(from))
  return out.map((claim) => claim.trim()).filter(Boolean)
}

/** Where "recent" stops meaning anything, and the student should hear how old the accounts are. */
const OLD_AFTER_DAYS = 180

/** Years the way a person says them, because the student is being told, not shown a figure. */
const YEARS = new Map([
  [1, 'a year'],
  [1.5, 'a year and a half'],
  [2, 'two years'],
  [2.5, 'two and a half years'],
  [3, 'three years']
])

/** How old an account is, in words. Null while it is recent enough that saying so is noise. */
export function ageOf(daysAgo: number): string | null {
  if (daysAgo < OLD_AFTER_DAYS) return null
  if (daysAgo < 365) return `about ${Math.round(daysAgo / 30)} months old`
  const said = YEARS.get(Math.round((daysAgo / 365) * 2) / 2)
  return said ? `about ${said} old` : 'over three years old'
}

function evidenceOf(sentence: Sentence, account: Account): Evidence {
  return { sentence, company: account.title.slice(0, 60), title: SOURCE_LABEL[account.source], url: account.url }
}

/**
 * What an interview at the company looked like, said from the accounts and
 * nothing else. The same gate as companion chat: a citation survives only
 * where the retriever returned it, and here the retriever is the account list.
 * The gate is per claim rather than per reply, because one id the model got
 * right is not evidence for the sentences beside it. How old the accounts are
 * is said first, from their dates, with no model in it. The reply arrives
 * whole rather than streamed, so a reply that fell apart is retried on a
 * shorter prompt and never shown.
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

  // The boards have gone quiet, so a brief written today can be about a loop that
  // ran two years ago. The prompt asks the model to say so and the model does not,
  // and the dates are here to be read, so the code says it instead.
  const age = ageOf(span.newestDaysAgo)
  const note = age === null ? '' : `${accounts.length === 1 ? 'This account is' : 'The newest of these is'} ${age}. `

  const attempt = async (sentences: Sentence[], temperature: number): Promise<Brief | null> => {
    const raw = await llm.text({
      // Prose, like companion chat, which is also on this lane. The careful lane
      // is for the coach's judgement; measured against the configured endpoint
      // the bigger model collapsed into a run of one character on this prompt
      // four times out of four, and the quick one wrote it every time in a third
      // of the wire time.
      lane: 'fast',
      temperature,
      maxTokens: 700,
      ...interviewBrief({ company, sentences, ...span })
    })
    if (degenerate(raw)) return null
    const valid = new Set(sentences.map((sentence) => sentence.id))
    const kept: string[] = []
    const cited = new Set<string>()
    for (const claim of claims(raw)) {
      const filter = new CitationFilter(valid)
      const prose = `${filter.push(claim)}${filter.flush()}`
      // Prose about an interview with nothing behind it is the one thing this
      // must not write, and a reply is a handful of claims rather than one. A
      // claim the accounts cannot back is dropped where it stands, so the
      // student is never told what people were paid by a sentence that sat
      // next to a cited one.
      if (filter.citations.length === 0) continue
      kept.push(prose)
      for (const id of filter.citations) cited.add(id)
    }
    const text = tidy(kept.join(' '))
    // What is left of a reply mostly made up is a stub, and half a thought about
    // an interview is worse than saying the accounts could not be written up.
    if (cited.size === 0 || degenerate(text)) return null
    // One chip per account: two sentences from one write-up are one place to go.
    const seen = new Set<string>()
    const sources = sentences
      .filter((sentence) => cited.has(sentence.id) && !seen.has(sentence.postingId) && seen.add(sentence.postingId))
      .map((sentence) => evidenceOf(sentence, byId.get(sentence.postingId)!))
    // The note is not a claim about the interview, it is what the code knows about
    // the accounts, so it is written on rather than put through the gate.
    return { kind: 'brief', text: `${note}${text}`, citations: [...cited], sources }
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
