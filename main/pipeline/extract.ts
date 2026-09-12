import type { Concept } from '../../shared/types.ts'
import { conceptsOut } from '../../shared/schemas.ts'
import { extractConcepts as prompt } from '../../shared/prompts.ts'
import type { LlmLike } from '../llm/service.ts'

/** A concept mentioned in passing is not worth interrupting a student over. */
const KEEP: Concept['confidence'][] = ['medium', 'high']

export async function extractConcepts(llm: LlmLike, transcript: string): Promise<Concept[]> {
  if (transcript.trim().length < 200) return []
  const { concepts } = await llm.json(conceptsOut, { lane: 'fast', ...prompt(transcript) })
  return concepts.filter((concept) => KEEP.includes(concept.confidence))
}
