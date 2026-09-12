import assert from 'node:assert/strict'
import { test } from 'node:test'
import { z } from 'zod'
import { ProviderError, type Provider, type Turn } from './provider.ts'
import { LlmError, ModelService, normaliseBaseUrl, protocolFor, type LlmConfig } from './service.ts'

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

test('the lane picks the model', async () => {
  const fake = new FakeProvider()
  fake.replies = ['{"ok":true}', '{"ok":true}']
  const llm = service(fake)
  await llm.json(OK, { lane: 'fast', system: 's', user: 'u' })
  await llm.json(OK, { lane: 'strong', system: 's', user: 'u' })
  assert.deepEqual(
    fake.turns.map((turn) => turn.model),
    ['quick', 'careful']
  )
  assert.equal(fake.turns[0]?.system, 's')
})

test('json mode is what the retry buys, not what every call pays for', async () => {
  const fake = new FakeProvider()
  fake.replies = ['{"ok":true}']
  const llm = service(fake)
  await llm.json(OK, { lane: 'fast', system: 's', user: 'u' })
  assert.equal(fake.turns[0]?.json, false, 'the first try is plain, which is several times faster')

  // A reply the schema refuses is asked for again, and that one is constrained.
  const again = new FakeProvider()
  again.replies = ['not json at all', '{"ok":true}']
  const second = service(again)
  assert.deepEqual(await second.json(OK, { lane: 'fast', system: 's', user: 'u' }), { ok: true })
  assert.deepEqual(again.turns.map((turn) => turn.json), [false, true])
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

test('how an endpoint speaks is decided from its address, and the address shaped to match', () => {
  assert.equal(protocolFor('https://api.anthropic.com'), 'anthropic')
  assert.equal(protocolFor('https://api.featherless.ai/v1'), 'openai')
  assert.equal(protocolFor('http://localhost:11434/v1'), 'openai')
  assert.equal(protocolFor('https://notanthropic.com/v1'), 'openai', 'a host merely ending in the letters is not it')
  assert.equal(protocolFor('not a url'), 'openai')
  for (const typed of ['http://localhost:11434', 'http://localhost:11434/', 'http://localhost:11434/v1/']) {
    assert.equal(normaliseBaseUrl(typed), 'http://localhost:11434/v1', `from ${typed}`)
  }
  for (const typed of ['https://api.anthropic.com', 'https://api.anthropic.com/', 'https://api.anthropic.com/v1']) {
    assert.equal(normaliseBaseUrl(typed), 'https://api.anthropic.com', `from ${typed}`)
  }
  assert.equal(normaliseBaseUrl('   '), '', 'and blank stays blank')
})

test('a call nobody asked for waits for nothing, because a student is behind it', async () => {
  // Pushed back every time: the asked call keeps trying, the volunteered one does not.
  const pushed = () => new ProviderError('slow down', 429)
  const pushy = new FakeProvider()
  pushy.replies = [pushed(), pushed(), pushed()]
  const llm = service(pushy)
  await assert.rejects(llm.text({ lane: 'fast', system: 's', user: 'u' }))
  assert.equal(pushy.turns.length, 3, 'an asked call is worth retrying')

  pushy.turns.length = 0
  pushy.replies = [pushed(), pushed(), pushed()]
  await assert.rejects(llm.text({ lane: 'fast', system: 's', user: 'u', unasked: true }))
  assert.equal(pushy.turns.length, 1, 'a volunteered one is said once or not at all')
})

test('a volunteered reply the schema refuses is dropped rather than asked again', async () => {
  const junk = new FakeProvider()
  junk.replies = ['not json', 'not json']
  const llm = service(junk)
  await assert.rejects(llm.json(OK, { lane: 'fast', system: 's', user: 'u', unasked: true }))
  assert.equal(junk.turns.length, 1)
})
