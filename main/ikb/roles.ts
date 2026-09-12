import { ROLE_FAMILIES, type Aim, type RoleFamily } from '../../shared/types.ts'
import type { Ikb } from './load.ts'

/**
 * Turning what a student says they are after into the track their postings
 * actually live under. The same move the rest of the app makes: they propose,
 * the postings decide, and nothing is claimed that the data cannot back.
 */

/** Below this the phrase has not really found anything. */
const ENOUGH = 3

const FAMILIES = new Set<string>(ROLE_FAMILIES)

export function resolveAim(ikb: Ikb, said: string): Aim {
  const phrase = said.trim()
  if (phrase.length < 2) return { said, family: null, matches: 0 }

  const results = ikb.titles.search(phrase, { combineWith: 'OR' }).slice(0, 60)
  const weight = new Map<RoleFamily, number>()
  for (const result of results) {
    const family = String(result['roleFamily'])
    if (!FAMILIES.has(family)) continue
    weight.set(family as RoleFamily, (weight.get(family as RoleFamily) ?? 0) + result.score)
  }

  const best = [...weight.entries()].sort((a, b) => b[1] - a[1])[0]
  if (!best) return { said, family: null, matches: 0 }

  const matches = results.filter((result) => result['roleFamily'] === best[0]).length
  return { said, family: matches >= ENOUGH ? best[0] : null, matches }
}

export function resolveAims(ikb: Ikb, said: string[]): Aim[] {
  return said.map((phrase) => resolveAim(ikb, phrase))
}

/** What the rest of the app filters on. Order kept, duplicates dropped. */
export function familiesOf(aims: Aim[]): RoleFamily[] {
  const seen: RoleFamily[] = []
  for (const aim of aims) {
    if (aim.family && !seen.includes(aim.family)) seen.push(aim.family)
  }
  return seen
}
