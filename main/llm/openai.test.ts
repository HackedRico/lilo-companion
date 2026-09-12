import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fakeFetch, json, sse } from './fake-fetch.ts'
import { OpenAiProvider } from './openai.ts'
import { ProviderError, type Turn } from './provider.ts'

const ENDPOINT = { baseUrl: 'https://host/v1', apiKey: 'sk-test' }
const TURN: Turn = { model: 'm', system: 's', user: 'u', temperature: 0.2, maxTokens: 50, json: true }

test('a completion goes to chat/completions with the key, the model and both messages', async () => {
  const wire = fakeFetch(() => json({ choices: [{ message: { content: '{"ok":true}' } }] }))
  assert.equal(await new OpenAiProvider(ENDPOINT, wire.fetch).complete(TURN), '{"ok":true}')
  const call = wire.calls[0]
  assert.equal(call?.url, 'https://host/v1/chat/completions')
  assert.equal(call?.headers.get('authorization'), 'Bearer sk-test')
  const body = call?.body ?? {}
  assert.equal(body['model'], 'm')
  assert.equal(body['temperature'], 0.2)
  assert.equal(body['max_tokens'], 50)
  assert.deepEqual(body['messages'], [
    { role: 'system', content: 's' },
    { role: 'user', content: 'u' }
  ])
  assert.deepEqual(body['response_format'], { type: 'json_object' }, 'json is asked for on the wire')
})

test('plain text is asked for without a response format', async () => {
  const wire = fakeFetch(() => json({ choices: [{ message: { content: 'hi' } }] }))
  assert.equal(await new OpenAiProvider(ENDPOINT, wire.fetch).complete({ ...TURN, json: false }), 'hi')
  assert.equal('response_format' in (wire.calls[0]?.body ?? {}), false)
})

test('a stream hands each token over and returns the whole', async () => {
  const chunk = (content: string, finish: string | null = null): string =>
    `data: ${JSON.stringify({
      id: 'c',
      object: 'chat.completion.chunk',
      created: 1,
      model: 'm',
      choices: [{ index: 0, delta: content ? { content } : {}, finish_reason: finish }]
    })}\n\n`
  const wire = fakeFetch(() => sse([chunk('Hel'), chunk('lo'), chunk('', 'stop'), 'data: [DONE]\n\n']))
  const tokens: string[] = []
  const whole = await new OpenAiProvider(ENDPOINT, wire.fetch).stream({ ...TURN, json: false }, (token) =>
    tokens.push(token)
  )
  assert.equal(whole, 'Hello')
  assert.deepEqual(tokens, ['Hel', 'lo'])
  assert.equal(wire.calls[0]?.body?.['stream'], true)
})

test("the endpoint's model list comes back sorted", async () => {
  const wire = fakeFetch(() => json({ object: 'list', data: [{ id: 'b' }, { id: 'a' }] }))
  assert.deepEqual(await new OpenAiProvider(ENDPOINT, wire.fetch).models(), ['a', 'b'])
  assert.equal(wire.calls[0]?.url, 'https://host/v1/models')
})

test('a refusal carries its status, and a model on this machine gets a placeholder key', async () => {
  const refused = fakeFetch(() => json({ error: { message: 'bad key' } }, 401))
  await assert.rejects(
    new OpenAiProvider(ENDPOINT, refused.fetch).complete(TURN),
    (error: unknown) => error instanceof ProviderError && error.status === 401 && /bad key/.test(error.message)
  )
  const local = fakeFetch(() => json({ choices: [{ message: { content: 'hi' } }] }))
  await new OpenAiProvider({ baseUrl: 'http://localhost:11434/v1', apiKey: '' }, local.fetch).complete(TURN)
  assert.equal(local.calls[0]?.headers.get('authorization'), 'Bearer local')
})
