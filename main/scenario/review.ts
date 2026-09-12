import type { Review } from '../../shared/types.ts'
import { reviewOut } from '../../shared/schemas.ts'
import { reviewSubmission } from '../../shared/prompts.ts'
import type { LlmLike } from '../llm/provider.ts'
import type { ScenarioRun } from './stakeholder.ts'

/** Words that mark a course title rather than something a lecturer says. */
const NOT_A_CONCEPT = /\b(best practices?|fundamentals?|techniques?|principles?|methodolog|101|introduction to)\b/i

/**
 * The companion listens for these words in a later lecture, so a topic no
 * lecturer would utter is dropped rather than watched for forever.
 */
function sayable(topic: string): boolean {
  const words = topic.trim().split(/\s+/)
  return words.length <= 3 && words.length > 0 && !NOT_A_CONCEPT.test(topic)
}

export async function reviewAnswer(llm: LlmLike, run: ScenarioRun, reply: string): Promise<Review> {
  const review = await llm.json(reviewOut, {
    lane: 'strong',
    temperature: 0.3,
    maxTokens: 900,
    ...reviewSubmission(run.scenario, run.uncoveredFacts, run.missedFacts, reply)
  })
  return { ...review, missedTopics: review.missedTopics.filter(sayable) }
}
