import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AccountCache, FRESH_MS } from './cache.ts'
import type { Account } from './sources.ts'

const ACCOUNT: Account = { id: 'hn:1', source: 'hn', title: 't', text: 'x', url: 'https://example.com', at: 5 }

test('what was read comes back for a day, then not', async () => {
  const cache = new AccountCache(join(await mkdtemp(join(tmpdir(), 'lilo-')), 'interviews'))
  assert.equal(await cache.read('Stripe', 1000), null)
  await cache.write('Stripe Inc.', [ACCOUNT], 1000)
  assert.deepEqual(await cache.read('stripe inc', 1000 + FRESH_MS / 2), [ACCOUNT])
  assert.equal(await cache.read('Stripe Inc.', 1000 + FRESH_MS + 1), null)
})
