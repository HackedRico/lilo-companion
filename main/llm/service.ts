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
  private queue<T>(work: () => Promise<T>): Promise<T> {
    if (!this.available) return Promise.reject(new LlmError('no model configured'))
    const run = this.tail.then(work, work)
    this.tail = run.catch(() => undefined)
    return run
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
   */
  async json<T>(schema: ZodType<T>, ask: Ask): Promise<T> {
    return this.queue(async () => {
      let lastIssue = ''
      for (let attempt = 0; attempt < 2; attempt++) {
        const user =
          attempt === 0
            ? ask.user
            : `${ask.user}\n\nYour previous reply could not be used: ${lastIssue}\nReturn only a JSON object matching the schema, nothing else.`
        const turn = this.turn({ ...ask, user }, true, 0.4, 1200)
        const raw = await this.withBackoff(() => this.provider.complete(turn))
        if (process.env['LILO_DEBUG_LLM']) {
          process.stderr.write(`\n--- ${turn.model} ---\n${raw}\n---\n`)
        }
        try {
          return schema.parse(jsonFrom(raw))
        } catch (error) {
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
    return this.queue(async () => {
      const turn = this.turn(ask, false, 0.6, 300)
      const raw = await this.withBackoff(() => this.provider.complete(turn))
      if (process.env['LILO_DEBUG_LLM']) {
        process.stderr.write(`\n--- ${turn.model} ---\n${raw}\n---\n`)
      }
      return raw.trim()
    })
  }

  /** Plain prose, streamed a token at a time. */
  async stream(ask: Ask, onToken: (token: string) => void): Promise<string> {
    return this.queue(() =>
      this.withBackoff(() => this.provider.stream(this.turn(ask, false, 0.6, 400), onToken))
    )
  }
}
