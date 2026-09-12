import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Decoder, encode } from './framing.ts'

test('a message survives the wire however it is chunked', () => {
  const one = encode({ event: { kind: 'pending', at: 1 } })
  const two = encode({ hello: 'again' })
  const whole = Buffer.concat([one, two])
  const decoder = new Decoder()
  const seen: unknown[] = []
  for (let i = 0; i < whole.length; i += 3) seen.push(...decoder.push(whole.subarray(i, i + 3)))
  assert.deepEqual(seen, [{ event: { kind: 'pending', at: 1 } }, { hello: 'again' }])
})

test('the length is the byte length, not the character count', () => {
  const framed = encode({ text: 'naïve ☃' })
  assert.equal(framed.readUInt32LE(0), framed.length - 4)
  assert.deepEqual(new Decoder().push(framed), [{ text: 'naïve ☃' }])
})
