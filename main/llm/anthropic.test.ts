import assert from 'node:assert/strict'
import { test } from 'node:test'
import { AnthropicProvider } from './anthropic.ts'
import { fakeFetch, json, sse } from './fake-fetch.ts'
import { ProviderError, type Turn } from './provider.ts'

const ENDPOINT = { baseUrl: 'https://host', apiKey: 'sk-ant' }
const TURN: Turn = { model: 'm', system: 's', user: 'u', temperature: 0.2, maxTokens: 50, json: true }

function message(text: string, stop = 'end_turn'): Record<string, unknown> {
  return {
    id: 'msg_1',
    type: 'message',
    role: 'assistant',
    model: 'm',
    content: [{ type: 'text', text }],
    stop_reason: stop,
    stop_sequence: null,
    usage: { input_tokens: 1, output_tokens: 1 }
  }
}

test('a message goes to v1/messages with the key header, the system apart, and no sampling', async () => {
  const wire = fakeFetch(() => json(message('{"ok":true}')))
  assert.equal(await new AnthropicProvider(ENDPOINT, wire.fetch).complete(TURN), '{"ok":true}')
  const call = wire.calls[0]
  assert.equal(call?.url, 'https://host/v1/messages')
  assert.equal(call?.headers.get('x-api-key'), 'sk-ant')
  assert.ok(call?.headers.get('anthropic-version'), 'the API wants a version header')
  const body = call?.body ?? {}
  assert.equal(body['model'], 'm')
  assert.equal(body['system'], 's')
  assert.equal(body['max_tokens'], 50)
  assert.deepEqual(body['messages'], [{ role: 'user', content: 'u' }])
  assert.equal('temperature' in body, false, 'current Claude models refuse sampling parameters')
})

test('a stream hands each text delta over and returns the whole', async () => {
  const event = (type: string, data: Record<string, unknown>): string =>
    `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`
  const wire = fakeFetch(() =>
    sse([
      event('message_start', { message: { ...message(''), content: [] } }),
      event('content_block_start', { index: 0, content_block: { type: 'text', text: '' } }),
      event('content_block_delta', { index: 0, delta: { type: 'text_delta', text: 'Hel' } }),
      event('content_block_delta', { index: 0, delta: { type: 'text_delta', text: 'lo' } }),
      event('content_block_stop', { index: 0 }),
      event('message_delta', { delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 2 } }),
      event('message_stop', {})
    ])
  )
  const tokens: string[] = []
  const whole = await new AnthropicProvider(ENDPOINT, wire.fetch).stream({ ...TURN, json: false }, (token) =>
    tokens.push(token)
  )
  assert.equal(whole, 'Hello')
  assert.deepEqual(tokens, ['Hel', 'lo'])
  assert.equal(wire.calls[0]?.body?.['stream'], true)
})

test("the endpoint's model list comes back sorted", async () => {
  const wire = fakeFetch(() =>
    json({
      data: [
        { id: 'b', type: 'model', display_name: 'B', created_at: '2026-01-01T00:00:00Z' },
        { id: 'a', type: 'model', display_name: 'A', created_at: '2026-01-01T00:00:00Z' }
      ],
      has_more: false,
      first_id: 'b',
      last_id: 'a'
    })
  )
  assert.deepEqual(await new AnthropicProvider(ENDPOINT, wire.fetch).models(), ['a', 'b'])
  assert.equal(wire.calls[0]?.url, 'https://host/v1/models')
})

test('an overload carries its status, and a declined reply is an error rather than an empty card', async () => {
  const busy = fakeFetch(() => json({ type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } }, 529))
  await assert.rejects(
    new AnthropicProvider(ENDPOINT, busy.fetch).complete(TURN),
    (error: unknown) => error instanceof ProviderError && error.status === 529
  )
  const declined = fakeFetch(() => json(message('', 'refusal')))
  await assert.rejects(
    new AnthropicProvider(ENDPOINT, declined.fetch).complete(TURN),
    (error: unknown) => error instanceof ProviderError && /declined/.test(error.message)
  )
})
