import assert from 'node:assert/strict'
import { test } from 'node:test'
import { z } from 'zod'
import { ProviderError, type Provider, type Turn } from './provider.ts'
import { LlmError, ModelService, normaliseBaseUrl, type LlmConfig } from './service.ts'

const CONFIG: LlmConfig = {
  protocol: 'openai',
  baseUrl: 'https://host/v1',
  apiKey: 'k',
  fast: 'quick',
  strong: 'careful'
}

const OK = z.object({ ok: z.boolean() })

/** Answers from a queue and keeps every turn, so what was asked can be checked. */
class FakeProvider implements Provider {
  readonly turns: Turn[] = []
  replies: (string | Error)[] = []
  private inFlight = 0
  peak = 0

  async complete(turn: Turn): Promise<string> {
    this.turns.push(turn)
    this.inFlight += 1
    this.peak = Math.max(this.peak, this.inFlight)
    await new Promise((done) => setTimeout(done, 5))
    this.inFlight -= 1
    const next = this.replies.shift() ?? ''
    if (next instanceof Error) throw next
    return next
  }

  async stream(turn: Turn, onToken: (token: string) => void): Promise<string> {
    this.turns.push(turn)
    const text = String(this.replies.shift() ?? '')
    for (const piece of text.split(' ')) onToken(`${piece} `)
    return text
  }

  async models(): Promise<string[]> {
    return ['quick', 'careful']
  }
}

function service(provider: Provider, config: LlmConfig = CONFIG): ModelService {
  return new ModelService(config, () => provider)
}

test('the lane picks the model, and a json ask says so to the provider', async () => {
  const fake = new FakeProvider()
  fake.replies = ['{"ok":true}', '{"ok":true}']
  const llm = service(fake)
  await llm.json(OK, { lane: 'fast', system: 's', user: 'u' })
  await llm.json(OK, { lane: 'strong', system: 's', user: 'u' })
  assert.deepEqual(
    fake.turns.map((turn) => turn.model),
    ['quick', 'careful']
  )
  assert.equal(fake.turns[0]?.json, true)
  assert.equal(fake.turns[0]?.system, 's')
})

test('plain text is asked for without json, and streams hand every token over', async () => {
  const fake = new FakeProvider()
  fake.replies = ['a reply', 'three word reply']
  const llm = service(fake)
  assert.equal(await llm.text({ lane: 'fast', system: 's', user: 'u' }), 'a reply')
  assert.equal(fake.turns[0]?.json, false)
  const tokens: string[] = []
  const whole = await llm.stream({ lane: 'fast', system: 's', user: 'u' }, (token) => tokens.push(token))
  assert.equal(whole, 'three word reply')
  assert.equal(tokens.join(''), 'three word reply ')
})

test('calls are serialised, so an endpoint never sees two at once', async () => {
  const fake = new FakeProvider()
  fake.replies = ['x', 'y', 'z']
  const llm = service(fake)
  await Promise.all([
    llm.text({ lane: 'fast', system: 's', user: '1' }),
    llm.text({ lane: 'fast', system: 's', user: '2' }),
    llm.text({ lane: 'fast', system: 's', user: '3' })
  ])
  assert.equal(fake.peak, 1)
  assert.deepEqual(
    fake.turns.map((turn) => turn.user),
    ['1', '2', '3'],
    'and in the order they were asked'
  )
})

test('a reply that misses the schema is asked for once more, with the issue named', async () => {
  const fake = new FakeProvider()
  fake.replies = ['{"nope":1}', '{"ok":true}']
  const llm = service(fake)
  assert.deepEqual(await llm.json(OK, { lane: 'fast', system: 's', user: 'u' }), { ok: true })
  assert.equal(fake.turns.length, 2)
  assert.match(fake.turns[1]?.user ?? '', /previous reply could not be used/)
})

test('two bad replies give up with an error rather than a guess', async () => {
  const fake = new FakeProvider()
  fake.replies = ['not json', 'still not']
  const llm = service(fake)
  await assert.rejects(llm.json(OK, { lane: 'fast', system: 's', user: 'u' }), LlmError)
  assert.equal(fake.turns.length, 2)
})

test('a fenced or padded reply is still read as json', async () => {
  const fake = new FakeProvider()
  fake.replies = ['Sure:\n```json\n{"ok": true}\n```\n']
  const llm = service(fake)
  assert.deepEqual(await llm.json(OK, { lane: 'fast', system: 's', user: 'u' }), { ok: true })
})

test('a push back from the endpoint is tried again after a pause', async () => {
  const fake = new FakeProvider()
  fake.replies = [new ProviderError('slow down', 429), 'fine']
  const llm = service(fake)
  assert.equal(await llm.text({ lane: 'fast', system: 's', user: 'u' }), 'fine')
  assert.equal(fake.turns.length, 2)
})

test('a refusal is not tried again, and keeps its status', async () => {
  const fake = new FakeProvider()
  fake.replies = [new ProviderError('bad key', 401)]
  const llm = service(fake)
  await assert.rejects(
    llm.text({ lane: 'fast', system: 's', user: 'u' }),
    (error: unknown) => error instanceof ProviderError && error.status === 401
  )
  assert.equal(fake.turns.length, 1)
})

test('nothing is asked until an address, a key and both models are set', async () => {
  const fake = new FakeProvider()
  const missing: Partial<LlmConfig>[] = [{ baseUrl: '' }, { apiKey: '' }, { fast: '' }, { strong: '' }]
  for (const gap of missing) {
    const llm = service(fake, { ...CONFIG, ...gap })
    assert.equal(llm.available, false, `with ${JSON.stringify(gap)}`)
    await assert.rejects(llm.text({ lane: 'fast', system: 's', user: 'u' }), LlmError)
  }
  assert.equal(fake.turns.length, 0)
  const local = service(fake, { ...CONFIG, baseUrl: 'http://localhost:11434/v1', apiKey: '' })
  assert.equal(local.available, true, 'a model on this machine wants no key')
})

test('reconfiguring swaps the provider underneath the same instance', async () => {
  const first = new FakeProvider()
  const second = new FakeProvider()
  first.replies = ['one']
  second.replies = ['two']
  const llm = new ModelService(CONFIG, (config) => (config.fast === 'other' ? second : first))
  assert.equal(await llm.text({ lane: 'fast', system: 's', user: 'u' }), 'one')
  llm.reconfigure({ ...CONFIG, fast: 'other' })
  assert.equal(await llm.text({ lane: 'fast', system: 's', user: 'u' }), 'two')
})

test('each protocol gets the address the way its endpoint wants it', () => {
  for (const typed of ['http://localhost:11434', 'http://localhost:11434/', 'http://localhost:11434/v1/']) {
    assert.equal(normaliseBaseUrl(typed, 'openai'), 'http://localhost:11434/v1', `openai from ${typed}`)
  }
  for (const typed of ['https://api.anthropic.com', 'https://api.anthropic.com/', 'https://api.anthropic.com/v1']) {
    assert.equal(normaliseBaseUrl(typed, 'anthropic'), 'https://api.anthropic.com', `anthropic from ${typed}`)
  }
  assert.equal(normaliseBaseUrl('   ', 'openai'), '', 'and blank stays blank')
})
