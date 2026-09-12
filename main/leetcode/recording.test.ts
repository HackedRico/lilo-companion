import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { WorkEvent } from '../../shared/leetcode.ts'
import { Recorder, parseRecording, readRecording, replay } from './recording.ts'

const EVENTS: WorkEvent[] = [
  { kind: 'opened', at: 1000, problem: { slug: 'two-sum', title: 'Two Sum', difficulty: 'Easy', statement: '' } },
  { kind: 'changed', at: 61000, code: 'x', language: 'python' },
  { kind: 'outcome', at: 62000, outcome: { verdict: 'accepted', detail: '' } }
]

test('a session written down reads back as the same events', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'lilo-'))
  const path = join(dir, 'nested', 'session.jsonl')
  const recorder = new Recorder(path)
  for (const event of EVENTS) await recorder.write(event)
  assert.deepEqual(await readRecording(path), EVENTS)
})

test('a line that is not an event is skipped, not fatal', () => {
  const text = `${JSON.stringify(EVENTS[0])}\nnot json\n{"kind":"nope","at":1}\n\n${JSON.stringify(EVENTS[2])}\n`
  assert.deepEqual(parseRecording(text), [EVENTS[0], EVENTS[2]])
})

test('replay keeps the order, caps the gaps and stamps events with now', async () => {
  const seen: WorkEvent[] = []
  const started = Date.now()
  await replay(EVENTS, async (event) => void seen.push(event), { maxGapMs: 20, now: () => 7 })
  assert.deepEqual(seen.map((event) => event.kind), ['opened', 'changed', 'outcome'])
  assert.ok(seen.every((event) => event.at === 7))
  assert.ok(Date.now() - started < 1000, 'a minute of recording did not take a minute')
})
