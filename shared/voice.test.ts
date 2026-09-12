import assert from 'node:assert/strict'
import { test } from 'node:test'
import { SPEECH_RATE, isSilent, wavOf } from './voice.ts'

const ascii = (view: DataView, at: number, length: number): string =>
  Array.from({ length }, (_, i) => String.fromCharCode(view.getUint8(at + i))).join('')

test('a wav is a 44 byte RIFF header over 16 bit mono samples at the speech rate', () => {
  const bytes = wavOf(new Float32Array([0, 0.5, -0.5, 1, -1]))
  const view = new DataView(bytes)
  assert.equal(bytes.byteLength, 44 + 5 * 2)
  assert.equal(ascii(view, 0, 4), 'RIFF')
  assert.equal(view.getUint32(4, true), 36 + 10)
  assert.equal(ascii(view, 8, 4), 'WAVE')
  assert.equal(ascii(view, 12, 4), 'fmt ')
  assert.equal(view.getUint16(20, true), 1, 'PCM')
  assert.equal(view.getUint16(22, true), 1, 'mono')
  assert.equal(view.getUint32(24, true), SPEECH_RATE)
  assert.equal(view.getUint32(28, true), SPEECH_RATE * 2)
  assert.equal(view.getUint16(34, true), 16)
  assert.equal(ascii(view, 36, 4), 'data')
  assert.equal(view.getUint32(40, true), 10)
  assert.equal(view.getInt16(44, true), 0)
  assert.equal(view.getInt16(46, true), Math.trunc(0.5 * 0x7fff))
  assert.equal(view.getInt16(48, true), -0x4000)
  assert.equal(view.getInt16(50, true), 0x7fff)
  assert.equal(view.getInt16(52, true), -0x8000)
})

test('a sample past full scale is clipped rather than wrapped', () => {
  const view = new DataView(wavOf(new Float32Array([1.7, -2.2])))
  assert.equal(view.getInt16(44, true), 0x7fff)
  assert.equal(view.getInt16(46, true), -0x8000)
})

test('the room alone is silence, and one word in it is not', () => {
  assert.equal(isSilent(new Float32Array(1600)), true)
  assert.equal(isSilent(new Float32Array(1600).fill(0.004)), true)
  const spoken = new Float32Array(1600)
  spoken[800] = 0.3
  assert.equal(isSilent(spoken), false)
})
