import OpenAI from 'openai'
import type { ZodType } from 'zod'

export type Lane = 'fast' | 'strong'

/**
 * Any endpoint that speaks the OpenAI chat API. There is no provider branch
 * anywhere below this line: Featherless, Ollama, OpenAI, LM Studio and the rest
 * differ only in an address, a key and two model names.
 */
export interface LlmConfig {
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

/** Where the app points when nothing has been configured at all. */
export const FALLBACK: LlmConfig = {
  baseUrl: 'https://api.featherless.ai/v1',
  apiKey: '',
  // Two sizes, because the lanes want different things: the quick one keeps up
  // with a lecture, the careful one holds a long nested schema together.
  fast: 'NousResearch/Meta-Llama-3.1-8B-Instruct',
  strong: 'Qwen/Qwen2.5-14B-Instruct'
}

/** A model on this machine needs no key, and asking for one would be rude. */
export function isLocal(baseUrl: string): boolean {
  return /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)(:|\/|$)/i.test(baseUrl)
}

/** Trailing slashes and a missing /v1 are the two things everyone gets wrong. */
export function normaliseBaseUrl(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, '')
  if (!trimmed) return ''
  return /\/v\d+$/.test(trimmed) ? trimmed : `${trimmed}/v1`
}

export class LlmError extends Error {}

function clientFor(config: LlmConfig): OpenAI {
  return new OpenAI({
    // Local servers ignore it, and the client refuses to start without one.
    apiKey: config.apiKey || 'local',
    baseURL: config.baseUrl,
    maxRetries: 0,
    timeout: TIMEOUT_MS
  })
}

/**
 * Every call is serialised, so one request that never returns holds up every
 * request behind it. The SDK's own default is ten minutes, which is ten minutes
 * of an orb sitting on "thinking" with nothing to show for it.
 */
const TIMEOUT_MS = 60000

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

function isRateLimit(error: unknown): boolean {
  return error instanceof OpenAI.APIError && (error.status === 429 || error.status === 503)
}

function jsonFrom(raw: string): unknown {
  const trimmed = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/, '')
  const start = trimmed.indexOf('{')
  const end = trimmed.lastIndexOf('}')
  if (start < 0 || end < start) throw new LlmError('no JSON object in reply')
  return JSON.parse(trimmed.slice(start, end + 1))
}

/**
 * One OpenAI-compatible client for both providers, with every call funnelled
 * through a single queue. Featherless returns 429 over concurrency, so nothing
 * here runs two requests at once.
 */
export class Llm implements LlmLike {
  config: LlmConfig
  private client: OpenAI
  private tail: Promise<unknown> = Promise.resolve()

  constructor(config: LlmConfig) {
    this.config = config
    this.client = clientFor(config)
  }

  /**
   * Settings can change while the app runs, and everything holds a reference to
   * this one instance, so the client is replaced underneath rather than rebuilt
   * around. Work already queued finishes against the client it started with.
   */
  reconfigure(config: LlmConfig): void {
    this.config = config
    this.client = clientFor(config)
  }

  get available(): boolean {
    if (!this.config.baseUrl) return false
    return this.config.apiKey.length > 0 || isLocal(this.config.baseUrl)
  }

  private model(lane: Lane): string {
    return lane === 'strong' ? this.config.strong : this.config.fast
  }

  /** Serialises every call, and backs off when the provider pushes back. */
  private queue<T>(work: () => Promise<T>): Promise<T> {
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
        if (!isRateLimit(error) || attempt >= 2) throw error
        await new Promise((resolve) => setTimeout(resolve, wait + Math.random() * 400))
        wait *= 2
      }
    }
  }

  /**
   * Featherless has JSON mode but not schema enforcement, so the schema goes in
   * the prompt and Zod is what actually decides. One retry, then give up: a
   * dropped card is better than an invented one.
   */
  async json<T>(schema: ZodType<T>, ask: Ask): Promise<T> {
    if (!this.available) throw new LlmError('no API key configured')
    return this.queue(async () => {
      let lastIssue = ''
      for (let attempt = 0; attempt < 2; attempt++) {
        const user =
          attempt === 0
            ? ask.user
            : `${ask.user}\n\nYour previous reply could not be used: ${lastIssue}\nReturn only a JSON object matching the schema, nothing else.`
        const completion = await this.withBackoff(() =>
          this.client.chat.completions.create({
            model: this.model(ask.lane),
            temperature: ask.temperature ?? 0.4,
            max_tokens: ask.maxTokens ?? 1200,
            response_format: { type: 'json_object' },
            messages: [
              { role: 'system', content: ask.system },
              { role: 'user', content: user }
            ]
          })
        )
        const raw = completion.choices[0]?.message?.content ?? ''
        if (process.env['LILO_DEBUG_LLM']) {
          process.stderr.write(
            `\n--- ${this.model(ask.lane)} finish=${completion.choices[0]?.finish_reason} ---\n${raw}\n---\n`
          )
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
    if (!this.available) throw new LlmError('no API key configured')
    return this.queue(async () => {
      const completion = await this.withBackoff(() =>
        this.client.chat.completions.create({
          model: this.model(ask.lane),
          temperature: ask.temperature ?? 0.6,
          max_tokens: ask.maxTokens ?? 300,
          messages: [
            { role: 'system', content: ask.system },
            { role: 'user', content: ask.user }
          ]
        })
      )
      return (completion.choices[0]?.message?.content ?? '').trim()
    })
  }

  /** Plain prose, streamed a token at a time. */
  async stream(ask: Ask, onToken: (token: string) => void): Promise<string> {
    if (!this.available) throw new LlmError('no API key configured')
    return this.queue(async () => {
      const stream = await this.withBackoff(() =>
        this.client.chat.completions.create({
          model: this.model(ask.lane),
          temperature: ask.temperature ?? 0.6,
          max_tokens: ask.maxTokens ?? 400,
          stream: true,
          messages: [
            { role: 'system', content: ask.system },
            { role: 'user', content: ask.user }
          ]
        })
      )
      let text = ''
      for await (const chunk of stream) {
        const token = chunk.choices[0]?.delta?.content
        if (!token) continue
        text += token
        onToken(token)
      }
      return text
    })
  }
}
