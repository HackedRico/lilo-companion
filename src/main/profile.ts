import type { Profile, RoleFamily } from '../shared/types.ts'
import { profileOut } from '../shared/schemas.ts'
import { extractProfile } from '../shared/prompts.ts'
import type { LlmLike } from './llm/provider.ts'

export const EMPTY_PROFILE: Profile = {
  major: '',
  year: '',
  courses: [],
  aims: [],
  targetRoles: [],
  interests: [],
  roleAffinity: {},
  heardTerms: []
}

/** A "sounds like me" tap is worth one vote toward that kind of work. */
export function withSignal(profile: Profile, role: RoleFamily): Profile {
  return {
    ...profile,
    roleAffinity: { ...profile.roleAffinity, [role]: (profile.roleAffinity[role] ?? 0) + 1 }
  }
}

/** Terms the student has now met in class, so the recap stops calling them gaps. */
export function withHeardTerms(profile: Profile, terms: string[]): Profile {
  return { ...profile, heardTerms: [...new Set([...profile.heardTerms, ...terms])] }
}

export function summarise(profile: Profile): string {
  const parts = [profile.major, profile.year].filter(Boolean)
  const aiming = profile.targetRoles.join(' or ')
  if (parts.length === 0 && !aiming) return 'a student who has not said much about themselves yet'
  return [parts.join(', '), aiming ? `aiming at ${aiming}` : ''].filter(Boolean).join(', ')
}

export async function profileFromChat(
  llm: LlmLike,
  history: { role: string; text: string }[],
  current: Profile
): Promise<Profile> {
  const read = await llm.json(profileOut, {
    lane: 'fast',
    temperature: 0.2,
    maxTokens: 400,
    ...extractProfile(history)
  })
  return {
    ...current,
    major: read.major || current.major,
    year: read.year || current.year,
    courses: read.courses.length > 0 ? read.courses : current.courses,
    targetRoles: read.targetRoles.length > 0 ? (read.targetRoles as RoleFamily[]) : current.targetRoles,
    aims: current.aims,
    interests: read.interests.length > 0 ? read.interests : current.interests
  }
}
