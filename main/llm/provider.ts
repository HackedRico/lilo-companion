/**
 * The seam between the service layer and the wire. A provider speaks one
 * protocol to one address and knows nothing about lanes, retries, queues or
 * schemas: those belong to the service, so every protocol gets them alike.
 */

/** Where a provider talks to. The key is empty for a model on this machine. */
export interface Endpoint {
  baseUrl: string
  apiKey: string
}

/** One exchange, already resolved to a model name. */
export interface Turn {
  model: string
  system: string
  user: string
  temperature: number
  maxTokens: number
  /** True when the reply has to be one JSON object, for protocols that can be told so. */
  json: boolean
}

export interface Provider {
  /** One reply, whole. */
  complete(turn: Turn): Promise<string>
  /** One reply, a token at a time, resolving to the whole of it. */
  stream(turn: Turn, onToken: (token: string) => void): Promise<string>
  /** The model names the endpoint offers. Throws where it publishes none. */
  models(): Promise<string[]>
}

/**
 * What an endpoint said, carrying the status the service decides retries on.
 * A null status is a failure before any reply: nothing listening, a timeout.
 */
export class ProviderError extends Error {
  readonly status: number | null

  constructor(message: string, status: number | null, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause })
    this.name = 'ProviderError'
    this.status = status
  }
}

/**
 * Every call is serialised, so one request that never returns holds up every
 * request behind it. The SDKs' own default is ten minutes, which is ten minutes
 * of an orb sitting on "thinking" with nothing to show for it.
 */
export const REQUEST_TIMEOUT_MS = 60000
