import type { ZodType } from 'zod'
import type { Protocol } from '../../shared/settings.ts'
import { ProviderError, type Provider, type Turn } from './provider.ts'

export type Lane = 'fast' | 'strong'

/**
 * Everything the app needs to reach a model. There is no vendor anywhere
 * below this line: an endpoint is a protocol, an address, a key and two model
 * names, and the student types all of them.
 */
export interface LlmConfig {
  protocol: Protocol
  baseUrl: string
  apiKey: string
  fast: string
  strong: string
}

export interface Ask {
  lane: Lane
  system: string
  user: string
  temperature?: number
  maxTokens?: number
}

/** A model on this machine needs no key, and asking for one would be rude. */
export function isLocal(baseUrl: string): boolean {
  return /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)(:|\/|$)/i.test(baseUrl)
}

/**
 * Anthropic's own service speaks its messages API and nothing else. Everything
 * else that a student would type, a hosted service, a gateway or a server on
 * this machine, speaks the OpenAI chat API. A gateway in front of Claude on
 * another host works through the OpenAI-compatible surface every gateway has.
 */
export function protocolFor(baseUrl: string): Protocol {
  try {
    return /(^|\.)anthropic\.com$/i.test(new URL(baseUrl).hostname) ? 'anthropic' : 'openai'
  } catch {
    return 'openai'
  }
}

/**
 * Each protocol has its own idea of where the version lives. OpenAI-style
 * addresses carry /v1 and everyone forgets it; the Anthropic SDK adds it
 * itself and doubles up if it is given. One rule per protocol, so whatever was
 * typed comes out the way that endpoint wants it.
 */
export function normaliseBaseUrl(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, '')
  if (!trimmed) return ''
  const versioned = /\/v\d+$/.test(trimmed)
  if (protocolFor(trimmed) === 'anthropic') return versioned ? trimmed.replace(/\/v\d+$/, '') : trimmed
  return versioned ? trimmed : `${trimmed}/v1`
}

export class LlmError extends Error {}

/**
 * The seam the rest of the app depends on. Everything above this line is
 * replaceable, which is how the whole loop can be tested without a model.
 */
export interface LlmLike {
  readonly available: boolean
  json<T>(schema: ZodType<T>, ask: Ask): Promise<T>
  text(ask: Ask): Promise<string>
  stream(ask: Ask, onToken: (token: string) => void): Promise<string>
}

/** Turns a configuration into the provider that speaks its protocol. */
export type ProviderFactory = (config: LlmConfig) => Provider

/** An endpoint asking for a pause, as opposed to refusing outright. */
function isPushback(error: unknown): boolean {
  return (
    error instanceof ProviderError &&
    (error.status === 429 || error.status === 503 || error.status === 529)
  )
}

function jsonFrom(raw: string): unknown {
  const trimmed = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/, '')
  const start = trimmed.indexOf('{')
  const end = trimmed.lastIndexOf('}')
  if (start < 0 || end < start) throw new LlmError('no JSON object in reply')
  return JSON.parse(trimmed.slice(start, end + 1))
}

/**
 * The service layer: one place that owns the lanes, the queue, the backoff
 * and the schema check, over a provider that only carries a turn across the
 * wire. Every call is funnelled through a single queue, because some endpoints
 * answer concurrency with a 429 and none of them need it.
 */
export class ModelService implements LlmLike {
  config: LlmConfig
  private readonly make: ProviderFactory
  private provider: Provider
  private tail: Promise<unknown> = Promise.resolve()

  constructor(config: LlmConfig, make: ProviderFactory) {
    this.config = config
    this.make = make
    this.provider = make(config)
  }

  /**
   * Settings can change while the app runs, and everything holds a reference to
   * this one instance, so the provider is replaced underneath rather than the
   * service rebuilt around. Work already queued finishes against the provider
   * it started with.
   */
  reconfigure(config: LlmConfig): void {
    this.config = config
    this.provider = this.make(config)
  }

  get available(): boolean {
    const { baseUrl, apiKey, fast, strong } = this.config
    if (!baseUrl || !fast || !strong) return false
    return apiKey.length > 0 || isLocal(baseUrl)
  }

  private turn(ask: Ask, json: boolean, temperature: number, maxTokens: number): Turn {
    return {
      model: ask.lane === 'strong' ? this.config.strong : this.config.fast,
      system: ask.system,
      user: ask.user,
      temperature: ask.temperature ?? temperature,
      maxTokens: ask.maxTokens ?? maxTokens,
      json
    }
  }

  /** Serialises every call, and backs off when the endpoint pushes back. */
  private queue<T>(work: (waited: number) => Promise<T>): Promise<T> {
    if (!this.available) return Promise.reject(new LlmError('no model configured'))
    const asked = Date.now()
    const start = (): Promise<T> => work(Date.now() - asked)
    const run = this.tail.then(start, start)
    this.tail = run.catch(() => undefined)
    return run
  }

  /**
   * Where one call's time went, so a slow reply can be read rather than
   * guessed at: waiting behind another call, or out on the wire.
   */
  private trace(turn: Turn, waited: number, wire: number, reply: string): void {
    if (!process.env['LILO_DEBUG_LLM']) return
    const into = turn.system.length + turn.user.length
    process.stderr.write(
      `\n--- ${turn.model} | queued ${waited}ms | wire ${wire}ms | in ${into} chars | out ${reply.length} chars ---\n${reply}\n---\n`
    )
  }

  private async withBackoff<T>(work: () => Promise<T>): Promise<T> {
    let wait = 800
    for (let attempt = 0; ; attempt++) {
      try {
        return await work()
      } catch (error) {
        if (!isPushback(error) || attempt >= 2) throw error
        await new Promise((resolve) => setTimeout(resolve, wait + Math.random() * 400))
        wait *= 2
      }
    }
  }

  /**
   * No protocol enforces a schema, so the schema goes in the prompt and Zod is
   * what actually decides. One retry, then give up: a dropped card is better
   * than an invented one.
   *
   * The first try does not ask for JSON mode. Where an endpoint implements it
   * by constraining what the model may emit, it costs seconds rather than
   * milliseconds: measured against Featherless, the same coach prompt answered
   * in about two seconds plain and about seven with JSON mode on. `jsonFrom`
   * already lifts an object out of fences or prose, so the fast way is tried
   * first and the guarantee is what the retry buys.
   */
  async json<T>(schema: ZodType<T>, ask: Ask): Promise<T> {
    return this.queue(async (waited) => {
      let lastIssue = ''
      // Set when the reply was not JSON at all, which is the only fault asking
      // the endpoint to constrain its output can fix. A reply that parsed and
      // then failed the schema is a different fault, and paying seconds of
      // constrained decoding for it buys nothing.
      let unparseable = false
      for (let attempt = 0; attempt < 2; attempt++) {
        const user =
          attempt === 0
            ? ask.user
            : `${ask.user}\n\nYour previous reply could not be used: ${lastIssue}\nReturn only a JSON object matching the schema, nothing else.`
        const turn = this.turn({ ...ask, user }, unparseable, 0.4, 1200)
        const sent = Date.now()
        const raw = await this.withBackoff(() => this.provider.complete(turn))
        this.trace(turn, waited, Date.now() - sent, raw)
        try {
          const parsed = jsonFrom(raw)
          unparseable = false
          return schema.parse(parsed)
        } catch (error) {
          unparseable = error instanceof LlmError || error instanceof SyntaxError
          lastIssue = (error as Error).message.slice(0, 400)
        }
      }
      throw new LlmError(`reply did not match the schema: ${lastIssue}`)
    })
  }

  /**
   * Plain prose, whole. A one line reply from a person is not structured data,
   * and wrapping it in JSON only gives the model something else to get wrong.
   */
  async text(ask: Ask): Promise<string> {
    return this.queue(async (waited) => {
      const turn = this.turn(ask, false, 0.6, 300)
      const sent = Date.now()
      const raw = await this.withBackoff(() => this.provider.complete(turn))
      this.trace(turn, waited, Date.now() - sent, raw)
      return raw.trim()
    })
  }

  /** Plain prose, streamed a token at a time. */
  async stream(ask: Ask, onToken: (token: string) => void): Promise<string> {
    return this.queue(async (waited) => {
      const turn = this.turn(ask, false, 0.6, 400)
      const sent = Date.now()
      const reply = await this.withBackoff(() => this.provider.stream(turn, onToken))
      this.trace(turn, waited, Date.now() - sent, reply)
      return reply
    })
  }
}
