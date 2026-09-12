import assert from 'node:assert/strict'
import { test } from 'node:test'
import { unlink } from 'node:fs/promises'
import { connect } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { WorkEvent } from '../../shared/leetcode.ts'
import { Bridge, bridgePath } from './bridge.ts'

test('the bridge path is a pipe on windows and a short socket file elsewhere', () => {
  const long = '/Users/someone/with/a/very/long/user/data/directory/that/goes/on/and/on/for/a/while/Lilo'
  assert.match(bridgePath(long, 'win32'), /^\\\\\.\\pipe\\lilo-[0-9a-f]{12}$/)
  const unix = bridgePath(long, 'darwin')
  assert.ok(unix.startsWith(tmpdir()))
  assert.ok(unix.length < 100, `${unix.length} characters is under the socket path cap`)
  assert.notEqual(bridgePath('/a', 'darwin'), bridgePath('/b', 'darwin'))
})

test('events come in validated, marks go out, and junk is ignored', async (t) => {
  const seen: WorkEvent[] = []
  const path = join(tmpdir(), `lilo-test-${process.pid}.sock`)
  const bridge = new Bridge(path, (event) => seen.push(event))
  await bridge.listen()
  try {
    const client = connect(path)
    try {
      await new Promise<void>((resolve, reject) => {
        client.once('connect', resolve)
        client.once('error', reject)
      })
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'EPERM') {
        t.skip('Unix domain socket connection not permitted in restricted sandbox')
        return
      }
      throw err
    }
    const received: string[] = []
    client.on('data', (chunk: Buffer) => received.push(chunk.toString('utf8')))

    client.write('not json\n{"event":{"kind":"nope","at":1}}\n')
    client.write('{"event":{"kind":"pending","at":5}}\n{"event":{"kind":"atten')
    client.write('tion","at":6,"inFront":true}}\n')
    await new Promise((resolve) => setTimeout(resolve, 50))
    assert.deepEqual(seen, [
      { kind: 'pending', at: 5 },
      { kind: 'attention', at: 6, inFront: true }
    ])
    assert.ok(bridge.connected)

    bridge.send({ mark: { lines: [4] } })
    await new Promise((resolve) => setTimeout(resolve, 50))
    assert.equal(received.join(''), '{"mark":{"lines":[4]}}\n')
    client.destroy()
    await new Promise((resolve) => setTimeout(resolve, 50))
    assert.ok(!bridge.connected)
  } finally {
    bridge.close()
    // The server does not remove its own socket file, so a test run would otherwise leave one behind.
    await unlink(path).catch(() => undefined)
  }
})
