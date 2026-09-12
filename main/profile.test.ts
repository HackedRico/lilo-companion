import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { ZodType } from 'zod'
import type { Ask, LlmLike } from './llm/service.ts'
import { EMPTY_PROFILE, profileFromChat } from './profile.ts'

/** Answers the profile schema the way onboarding's fast lane would. */
class Scripted implements LlmLike {
  readonly available = true
  reply: unknown = { major: 'computer science', year: 'junior', courses: [], targetRoles: ['backend'], interests: [] }
  async json<T>(schema: ZodType<T>, _ask: Ask): Promise<T> {
    return schema.parse(this.reply) as T
  }
  async text(): Promise<string> {
    throw new Error('not used')
  }
  async stream(): Promise<string> {
    throw new Error('not used')
  }
}

test('what onboarding heard is what the preferences window shows', async () => {
  const profile = await profileFromChat(new Scripted(), [{ role: 'student', text: 'cs junior, backend' }], EMPTY_PROFILE)
  assert.deepEqual(profile.targetRoles, ['backend'])
  assert.deepEqual(profile.aims, ['backend'], 'the window says the same thing the filter does')
})

test('an aim the student typed is left alone', async () => {
  const held = { ...EMPTY_PROFILE, aims: ['payments infrastructure'] }
  const profile = await profileFromChat(new Scripted(), [{ role: 'student', text: 'cs junior' }], held)
  assert.deepEqual(profile.aims, ['payments infrastructure'])
})
