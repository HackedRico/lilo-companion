import type { Gap, RoleFamily, Sentence, Seniority } from '../../shared/types.ts'
import type { Ikb } from './load.ts'

const EARLY: Seniority[] = ['intern', 'new_grad', 'junior']

/**
 * Below this many postings a percentage is noise, so the cohort widens to the
 * whole role rather than quoting a statistic off a handful of listings.
 */
const MIN_COHORT = 40

export interface GapResult {
  gaps: Gap[]
  /** Which postings the percentages were taken over, so the UI can be honest. */
  cohort: { roles: RoleFamily[]; earlyCareerOnly: boolean; postings: number }
}

/**
 * Short enough to read in a whisper, long enough to be a requirement rather
 * than a fragment of a job title.
 */
const QUOTABLE = { min: 60, max: 180 }

function mostQuotable(candidates: Sentence[]): Sentence | undefined {
  const byLength = [...candidates].sort((a, b) => a.text.length - b.text.length)
  return (
    byLength.find(
      (sentence) => sentence.text.length >= QUOTABLE.min && sentence.text.length <= QUOTABLE.max
    ) ?? byLength[0]
  )
}

export function computeGaps(
  ikb: Ikb,
  roles: RoleFamily[],
  heardTerms: string[],
  limit = 3
): GapResult {
  const wanted = new Set(roles.length > 0 ? roles : (['swe'] as RoleFamily[]))
  const onRole = [...ikb.postings.values()].filter((posting) => wanted.has(posting.roleFamily))
  const early = onRole.filter((posting) => EARLY.includes(posting.seniority))

  const earlyCareerOnly = early.length >= MIN_COHORT
  const cohort = earlyCareerOnly ? early : onRole
  const cohortIds = new Set(cohort.map((posting) => posting.id))

  // One posting counts once for a practice however often it repeats it.
  const practicesByPosting = new Map<string, Set<string>>()
  const examples = new Map<string, Sentence[]>()
  for (const sentence of ikb.sentences) {
    if (!cohortIds.has(sentence.postingId)) continue
    for (const tag of sentence.tags) {
      if (!ikb.practices.has(tag)) continue
      const seen = practicesByPosting.get(tag)
      if (seen) seen.add(sentence.postingId)
      else practicesByPosting.set(tag, new Set([sentence.postingId]))
      const bucket = examples.get(tag)
      if (bucket) bucket.push(sentence)
      else examples.set(tag, [sentence])
    }
  }

  const heard = new Set(heardTerms.map((term) => term.toLowerCase()))
  const gaps: Gap[] = []
  const ranked = [...practicesByPosting.entries()]
    .filter(([practice]) => !heard.has(practice.toLowerCase()))
    .map(([practice, postings]) => ({ practice, pct: postings.size / Math.max(1, cohort.length) }))
    .sort((a, b) => b.pct - a.pct)

  for (const { practice, pct } of ranked) {
    const candidates = examples.get(practice) ?? []
    const example = mostQuotable(candidates)
    if (!example) continue
    gaps.push({ practice, pctOfPostings: Math.round(pct * 100), exampleSentence: example })
    if (gaps.length === limit) break
  }

  return {
    gaps,
    cohort: { roles: [...wanted], earlyCareerOnly, postings: cohort.length }
  }
}
