import assert from 'node:assert/strict'
import { test } from 'node:test'
import { wavOf } from '../shared/voice.ts'
import { json } from './llm/fake-fetch.ts'
import { Transcriber } from './voice.ts'

/** Keeps the multipart form each request carried, which the JSON fake cannot read. */
function wire(answer: () => Response | Promise<Response>): {
  forms: FormData[]
  urls: string[]
  headers: Headers[]
  fetch: typeof globalThis.fetch
} {
  const forms: FormData[] = []
  const urls: string[] = []
  const headers: Headers[] = []
  const fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
    // The client probes a fetch it was handed with a data URL once, to learn
    // whether it can carry a form. That is not a request anyone made.
    if (url.startsWith('data:')) return new Response('')
    urls.push(url)
    headers.push(new Headers(init?.headers))
    const body = init?.body
    forms.push(
      body instanceof FormData
        ? body
        : await new Response(body as ConstructorParameters<typeof Response>[0], { headers: init?.headers }).formData()
    )
    return answer()
  }
  return { forms, urls, headers, fetch: fetch as typeof globalThis.fetch }
}

const HOSTED = { baseUrl: 'https://host/v1', apiKey: 'sk-test', model: 'whisper-1' }
const LOCAL = { baseUrl: 'http://localhost:8000/v1', apiKey: '', model: 'small.en' }
const speech = new Uint8Array(wavOf(new Float32Array([0.2, -0.2, 0.1])))

test('speech goes to audio/transcriptions as a wav, with the key and the model', async () => {
  const w = wire(() => json({ text: '  two sum  ' }))
  assert.deepEqual(await new Transcriber(HOSTED, w.fetch).hear(speech), { ok: true, text: 'two sum' })
  assert.equal(w.urls[0], 'https://host/v1/audio/transcriptions')
  assert.equal(w.headers[0]?.get('authorization'), 'Bearer sk-test')
  const form = w.forms[0]
  assert.equal(form?.get('model'), 'whisper-1')
  assert.equal(form?.get('response_format'), 'json')
  const file = form?.get('file')
  assert.ok(file instanceof File, 'the wav travels as a file part')
  assert.equal(file.name, 'speech.wav')
  assert.equal(file.type, 'audio/wav')
  assert.equal(file.size, speech.byteLength)
})

test('a server on this machine needs no key, and gets the placeholder the client insists on', async () => {
  const w = wire(() => json({ text: 'hi' }))
  assert.deepEqual(await new Transcriber(LOCAL, w.fetch).hear(speech), { ok: true, text: 'hi' })
  assert.equal(w.headers[0]?.get('authorization'), 'Bearer local')
  assert.equal(w.forms[0]?.get('model'), 'small.en')
})

test('what is missing is said before the wire is tried', async () => {
  const w = wire(() => json({ text: 'never' }))
  const nowhere = await new Transcriber({ ...HOSTED, baseUrl: '' }, w.fetch).hear(speech)
  assert.equal(nowhere.ok, false)
  const keyless = await new Transcriber({ ...HOSTED, apiKey: '' }, w.fetch).hear(speech)
  assert.equal(keyless.ok, false)
  assert.equal(w.urls.length, 0)
})

test('a refusal, a wrong address and nothing listening each come back as a line', async () => {
  const refused = await new Transcriber(HOSTED, wire(() => json({ error: { message: 'bad key' } }, 401)).fetch).hear(speech)
  assert.deepEqual(refused, { ok: false, detail: 'That key was refused.' })

  const missing = await new Transcriber(HOSTED, wire(() => json({ error: { message: 'Not Found' } }, 404)).fetch).hear(speech)
  assert.equal(missing.ok, false)
  assert.match(missing.ok ? '' : missing.detail, /Nothing at that address transcribes/)

  const noModel = await new Transcriber(
    HOSTED,
    wire(() => json({ error: { message: 'The model `x` does not exist' } }, 404)).fetch
  ).hear(speech)
  assert.deepEqual(noModel, { ok: false, detail: 'No model by that name at that address.' })

  const down = await new Transcriber(HOSTED, wire(() => Promise.reject(new Error('fetch failed'))).fetch).hear(speech)
  assert.deepEqual(down, { ok: false, detail: 'Nothing answered at the voice address.' })
})

test('silence and a reply with no text in it are said, not sent on', async () => {
  const silent = await new Transcriber(HOSTED, wire(() => json({ text: '   ' })).fetch).hear(speech)
  assert.deepEqual(silent, { ok: false, detail: 'I heard nothing in that.' })
  const wordless = await new Transcriber(HOSTED, wire(() => json({ segments: [] })).fetch).hear(speech)
  assert.equal(wordless.ok, false)
})

test('settings changed under it are what the next press uses', async () => {
  const w = wire(() => json({ text: 'ok' }))
  const transcriber = new Transcriber(HOSTED, w.fetch)
  transcriber.reconfigure(LOCAL)
  assert.equal(transcriber.available, true)
  await transcriber.hear(speech)
  assert.equal(w.urls[0], 'http://localhost:8000/v1/audio/transcriptions')
})
