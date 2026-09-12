import assert from 'node:assert/strict'
import { test } from 'node:test'
import { wavOf } from '../shared/voice.ts'
import { fakeFetch, formOf, json } from './llm/fake-fetch.ts'
import { Transcriber } from './voice.ts'

const HOSTED = { baseUrl: 'https://host/v1', apiKey: 'sk-test', model: 'whisper-1' }
const LOCAL = { baseUrl: 'http://localhost:8000/v1', apiKey: '', model: 'small.en' }
const speech = new Uint8Array(wavOf(new Float32Array([0.2, -0.2, 0.1])))

/** One reply, and what the transcriber made of it. */
async function heard(config: typeof HOSTED, answer: () => Response | Promise<Response>) {
  const wire = fakeFetch(answer)
  return { said: await new Transcriber(config, wire.fetch).hear(speech), wire }
}

test('speech goes to audio/transcriptions as a wav, with the key and the model', async () => {
  const { said, wire } = await heard(HOSTED, () => json({ text: '  two sum  ' }))
  assert.deepEqual(said, { ok: true, text: 'two sum' })
  const call = wire.calls[0]
  assert.equal(call?.url, 'https://host/v1/audio/transcriptions')
  assert.equal(call?.headers.get('authorization'), 'Bearer sk-test')
  const form = call ? await formOf(call) : null
  assert.equal(form?.get('model'), 'whisper-1')
  assert.equal(form?.get('response_format'), 'json')
  const file = form?.get('file')
  assert.ok(file instanceof File, 'the wav travels as a file part')
  assert.equal(file.name, 'speech.wav')
  assert.equal(file.type, 'audio/wav')
  assert.equal(file.size, speech.byteLength)
})

test('a server on this machine needs no key, and gets the placeholder the client insists on', async () => {
  const { said, wire } = await heard(LOCAL, () => json({ text: 'hi' }))
  assert.deepEqual(said, { ok: true, text: 'hi' })
  assert.equal(wire.calls[0]?.headers.get('authorization'), 'Bearer local')
  const form = wire.calls[0] ? await formOf(wire.calls[0]) : null
  assert.equal(form?.get('model'), 'small.en')
})

test('with no address, nothing is tried', async () => {
  const { said, wire } = await heard({ ...HOSTED, baseUrl: '' }, () => json({ text: 'never' }))
  assert.equal(said.ok, false)
  assert.equal(wire.calls.length, 0)
})

test('a refusal says whether there was a key to refuse', async () => {
  const refused = await heard(HOSTED, () => json({ error: { message: 'bad key' } }, 401))
  assert.deepEqual(refused.said, { ok: false, detail: 'That key was refused.' })
  const keyless = await heard({ ...HOSTED, apiKey: '' }, () => json({ error: { message: 'no key' } }, 401))
  assert.deepEqual(keyless.said, { ok: false, detail: 'That address wants a key. Add one under Settings, Model, Voice.' })
})

test('a wrong address, a wrong model, a pause and nothing listening each come back as a line', async () => {
  const missing = await heard(HOSTED, () => json({ error: { message: 'Not Found' } }, 404))
  assert.match(missing.said.ok ? '' : missing.said.detail, /Nothing at that address transcribes/)

  const noModel = await heard(HOSTED, () => json({ error: { message: 'The model `x` does not exist' } }, 404))
  assert.deepEqual(noModel.said, { ok: false, detail: 'No model by that name at that address.' })

  const busy = await heard(HOSTED, () => json({ error: { message: 'slow down' } }, 429))
  assert.deepEqual(busy.said, { ok: false, detail: 'The transcriber asked for a pause. Try again in a moment.' })

  const down = await heard(HOSTED, () => Promise.reject(new Error('fetch failed')))
  assert.deepEqual(down.said, { ok: false, detail: 'Nothing answered at that address.' })
})

test('silence and a reply with no text in it are said, not sent on', async () => {
  const silent = await heard(HOSTED, () => json({ text: '   ' }))
  assert.deepEqual(silent.said, { ok: false, detail: 'I heard nothing in that.' })
  const wordless = await heard(HOSTED, () => json({ segments: [] }))
  assert.equal(wordless.said.ok, false)
})

test('settings changed under it are what the next press uses', async () => {
  const wire = fakeFetch(() => json({ text: 'ok' }))
  const transcriber = new Transcriber(HOSTED, wire.fetch)
  transcriber.reconfigure(LOCAL)
  assert.equal(transcriber.available, true)
  await transcriber.hear(speech)
  assert.equal(wire.calls[0]?.url, 'http://localhost:8000/v1/audio/transcriptions')
})
