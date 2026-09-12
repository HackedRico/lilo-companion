import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AccountCache, FRESH_MS } from './cache.ts'
import type { Account } from './sources.ts'

const ACCOUNT: Account = { id: 'hn:1', source: 'hn', title: 't', text: 'x', url: 'https://example.com', at: 5 }

test('what was read comes back for a day, then not, and survives a new cache on the same folder', async () => {
  const dir = join(await mkdtemp(join(tmpdir(), 'lilo-')), 'interviews')
  const cache = new AccountCache(dir)
  assert.equal(await cache.read('Stripe', 1000), null)
  await cache.write('Stripe Inc.', [ACCOUNT], 1000)
  assert.deepEqual(await cache.read('stripe inc', 1000 + FRESH_MS / 2), [ACCOUNT])
  assert.deepEqual(await new AccountCache(dir).read('Stripe Inc.', 1000 + FRESH_MS / 2), [ACCOUNT], 'read back from disk')
  assert.equal(await cache.read('Stripe Inc.', 1000 + FRESH_MS + 1), null)
})

test('a file that is not accounts is a miss, not a crash', async () => {
  const dir = join(await mkdtemp(join(tmpdir(), 'lilo-')), 'interviews')
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'stripe.json'), '{"fetchedAt": 1000, "accounts": [{"id": 1}]}')
  assert.equal(await new AccountCache(dir).read('Stripe', 1000), null)
})
