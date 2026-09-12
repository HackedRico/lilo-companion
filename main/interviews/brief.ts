import type { Evidence } from '../../shared/types.ts'
import { interviewBrief } from '../../shared/prompts.ts'
import type { LlmLike } from '../llm/service.ts'
import { CitationFilter } from '../chat/citations.ts'
import { SOURCE_LABEL, sentencesOf, type Account } from './sources.ts'

export interface Brief {
  citations: string[]
  sources: Evidence[]
}

/**
 * What a recent interview at the company looked like, said from the accounts
 * and nothing else. The same gate as companion chat: a citation survives only
 * where the retriever returned it, and here the retriever is the account list.
 */
export async function briefInterview(
  llm: LlmLike,
  company: string,
  accounts: Account[],
  onToken: (token: string) => void,
  now = Date.now()
): Promise<Brief> {
  const sentences = sentencesOf(accounts)
  const filter = new CitationFilter(new Set(sentences.map((sentence) => sentence.id)))
  const dates = accounts.map((account) => account.at).filter((at) => at > 0)

  await llm.stream(
    {
      lane: 'strong',
      maxTokens: 500,
      ...interviewBrief({
        company,
        sentences,
        accounts: accounts.length,
        newestDaysAgo: dates.length ? Math.round((now - Math.max(...dates)) / 86400000) : null,
        oldestDaysAgo: dates.length ? Math.round((now - Math.min(...dates)) / 86400000) : null
      })
    },
    (token) => {
      const clean = filter.push(token)
      if (clean) onToken(clean)
    }
  )
  const tail = filter.flush()
  if (tail) onToken(tail)

  const byId = new Map(accounts.map((account) => [account.id, account]))
  const cited = new Set(filter.citations)
  const sources: Evidence[] = []
  for (const sentence of sentences) {
    if (!cited.has(sentence.id)) continue
    const account = byId.get(sentence.postingId)
    if (!account) continue
    sources.push({ sentence, company: SOURCE_LABEL[account.source], title: account.title, url: account.url })
  }
  return { citations: filter.citations, sources }
}
