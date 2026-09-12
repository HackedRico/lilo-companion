import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readLecture } from './lecture.ts'

test('a lecture written on either OS comes back one line per thing said', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'lilo-'))
  const path = join(dir, 'lecture.txt')
  await writeFile(path, 'Today we start on hash tables.\r\n\r\n  A hash table is an array.  \r\n')
  assert.equal(await readLecture(path), 'Today we start on hash tables.\nA hash table is an array.')
})
