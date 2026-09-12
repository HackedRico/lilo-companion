import type { Card, Profile, Sentence } from '../../shared/types.ts'
import { companionChat } from '../../shared/prompts.ts'
import type { LlmLike } from '../llm/service.ts'
import type { Ikb } from '../ikb/load.ts'
import { freeSearch } from '../ikb/search.ts'
import { CitationFilter } from './citations.ts'

export interface ChatContext {
  profile: Profile
  transcript: string
  card: Card | null
  history: { role: string; text: string }[]
}

export interface ChatAnswer {
  text: string
  citations: string[]
  sources: Sentence[]
}

export async function askCompanion(
  llm: LlmLike,
  ikb: Ikb,
  context: ChatContext,
  question: string,
  onToken: (token: string) => void
): Promise<ChatAnswer> {
  const sources = freeSearch(ikb, question, 5)
  const filter = new CitationFilter(new Set(sources.map((sentence) => sentence.id)))

  await llm.stream(
    {
      lane: 'fast',
      // Three or four sentences of substance, with room to finish the last one.
      maxTokens: 480,
      ...companionChat(
        context.profile,
        context.transcript,
        context.card,
        sources,
        context.history.slice(-10),
        question
      )
    },
    (token) => {
      const clean = filter.push(token)
      if (clean) onToken(clean)
    }
  )

  const tail = filter.flush()
  if (tail) onToken(tail)

  const cited = new Set(filter.citations)
  return {
    text: '',
    citations: filter.citations,
    sources: sources.filter((sentence) => cited.has(sentence.id))
  }
}
