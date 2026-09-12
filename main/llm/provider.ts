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
 * What an endpoint's failure means, said for a student. `it` names what was
 * asked, so the connection test and the transcriber say the same thing about
 * the same fault. A caller that knows a better reading of one status says it
 * first and falls through to this for the rest.
 */
export function reasonFor(error: unknown, it = 'It'): string {
  const status = error instanceof ProviderError ? error.status : null
  const message = error instanceof Error ? error.message : String(error)
  if (/model_gated|gated/i.test(message)) return 'That model is gated to your account. Pick another.'
  if (status === 401 || status === 403 || /401|403|unauthor|invalid.*key/i.test(message)) return 'That key was refused.'
  if (status === 404 || /404|not found|does not exist/i.test(message)) return 'No model by that name at that address.'
  if (status === 413) return 'That was too much for it to take at once.'
  if (status === 429 || status === 503 || status === 529) return `${it} asked for a pause. Try again in a moment.`
  if (/timeout|timed out|ETIMEDOUT|aborted/i.test(message)) return `${it} did not answer in time.`
  if (/ECONNREFUSED|fetch failed|ENOTFOUND|connection error/i.test(message)) return 'Nothing answered at that address.'
  // A schema mismatch carries the whole of zod's complaint, and a student who
  // uploaded a file was shown it: expected array, received undefined, in JSON.
  if (/did not match the schema/i.test(message)) return `${it} answered with something I could not read.`
  return message.slice(0, 200)
}

/**
 * Every call is serialised, so one request that never returns holds up every
 * request behind it. The SDKs' own default is ten minutes, which is ten minutes
 * of an orb sitting on "thinking" with nothing to show for it.
 */
export const REQUEST_TIMEOUT_MS = 60000
