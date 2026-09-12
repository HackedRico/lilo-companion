/**
 * A fetch that answers from a handler and keeps every request, so a provider's
 * wire shape can be checked without a network. Test support only.
 */

export interface Call {
  url: string
  method: string
  headers: Headers
  body: Record<string, unknown> | null
  /** The body as sent, for a test that wants a form rather than JSON. */
  raw: RequestInit['body'] | undefined
}

export interface FakeFetch {
  calls: Call[]
  fetch: typeof globalThis.fetch
}

export function fakeFetch(answer: (call: Call) => Response | Promise<Response>): FakeFetch {
  const calls: Call[] = []
  const fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
    // The OpenAI client probes a fetch it was handed with a data URL once, to
    // learn whether it can carry a form. That is not a request anyone made.
    if (url.startsWith('data:')) return new Response('')
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined))
    const text = typeof init?.body === 'string' ? init.body : ''
    const call: Call = {
      url,
      method: init?.method ?? 'GET',
      headers,
      body: text ? (JSON.parse(text) as Record<string, unknown>) : null,
      raw: init?.body
    }
    calls.push(call)
    return answer(call)
  }
  return { calls, fetch: fetch as typeof globalThis.fetch }
}

/** The multipart form a call carried, whichever shape the client sent it in. */
export function formOf(call: Call): Promise<FormData> {
  if (call.raw instanceof FormData) return Promise.resolve(call.raw)
  return new Response(call.raw as ConstructorParameters<typeof Response>[0], { headers: call.headers }).formData()
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

export function sse(events: string[]): Response {
  return new Response(events.join(''), { status: 200, headers: { 'content-type': 'text/event-stream' } })
}
