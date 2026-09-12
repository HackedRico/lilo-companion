import { randomUUID } from 'node:crypto'
import type { Card, Profile, Scenario } from '../../shared/types.ts'
import { scenarioOut } from '../../shared/schemas.ts'
import { generateScenario as prompt } from '../../shared/prompts.ts'
import type { LlmLike } from '../llm/service.ts'
import type { Ikb } from '../ikb/load.ts'

export async function generateScenario(
  llm: LlmLike,
  ikb: Ikb,
  card: Card,
  profile: Profile
): Promise<Scenario> {
  const sentence = card.sentences[0]
  if (!sentence) throw new Error('a scenario needs a posting sentence to stand on')
  const posting = ikb.postings.get(sentence.postingId)
  if (!posting) throw new Error('the cited sentence has no posting behind it')

  const written = await llm.json(scenarioOut, {
    lane: 'strong',
    temperature: 0.7,
    maxTokens: 2000,
    ...prompt(card, sentence, posting, profile)
  })

  return {
    id: `sc_${randomUUID().slice(0, 8)}`,
    ...written,
    visibleMessage: unplaceholder(written.visibleMessage),
    citedSentenceId: sentence.id
  }
}

/**
 * Models reach for [Student's Name] however firmly the prompt says not to. A
 * greeting with the placeholder cut out still reads like a message; one with it
 * left in reads like a template.
 */
function unplaceholder(message: string): string {
  return message
    .replace(/\[[^\]]{0,40}\]/g, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/([,!?]) ,/g, '$1')
    .replace(/^(\s*(?:hi|hey|hello))\s*,/gim, '$1,')
    .trim()
}
