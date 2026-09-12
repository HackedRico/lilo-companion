/**
 * A fetch that answers from a handler and keeps every request, so a provider's
 * wire shape can be checked without a network. Test support only.
 */

export interface Call {
  url: string
  method: string
  headers: Headers
  body: Record<string, unknown> | null
}

export interface FakeFetch {
  calls: Call[]
  fetch: typeof globalThis.fetch
}

export function fakeFetch(answer: (call: Call) => Response): FakeFetch {
  const calls: Call[] = []
  const fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined))
    const raw = typeof init?.body === 'string' ? init.body : ''
    const call: Call = {
      url,
      method: init?.method ?? 'GET',
      headers,
      body: raw ? (JSON.parse(raw) as Record<string, unknown>) : null
    }
    calls.push(call)
    return answer(call)
  }
  return { calls, fetch: fetch as typeof globalThis.fetch }
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

export function sse(events: string[]): Response {
  return new Response(events.join(''), { status: 200, headers: { 'content-type': 'text/event-stream' } })
}
