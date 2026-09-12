import OpenAI from 'openai'
import { ProviderError, REQUEST_TIMEOUT_MS, type Endpoint, type Provider, type Turn } from './provider.ts'

type Request = Omit<OpenAI.ChatCompletionCreateParamsNonStreaming, 'stream'>

/**
 * Anything that speaks the OpenAI chat completions API, which is most
 * services and every local server. The address is the whole of what differs
 * between them, so this is the one provider most students will ever use.
 */
export class OpenAiProvider implements Provider {
  private readonly client: OpenAI

  constructor(endpoint: Endpoint, fetch?: typeof globalThis.fetch) {
    this.client = new OpenAI({
      // Local servers ignore it, and the client refuses to start without one.
      apiKey: endpoint.apiKey || 'local',
      baseURL: endpoint.baseUrl,
      maxRetries: 0,
      timeout: REQUEST_TIMEOUT_MS,
      fetch
    })
  }

  async complete(turn: Turn): Promise<string> {
    const completion = await this.guard(() => this.client.chat.completions.create(this.request(turn)))
    return completion.choices[0]?.message?.content ?? ''
  }

  async stream(turn: Turn, onToken: (token: string) => void): Promise<string> {
    return this.guard(async () => {
      const stream = await this.client.chat.completions.create({ ...this.request(turn), stream: true })
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

  async models(): Promise<string[]> {
    return this.guard(async () => {
      const ids: string[] = []
      for await (const model of this.client.models.list()) ids.push(model.id)
      return ids.sort()
    })
  }

  /**
   * JSON mode is asked for where the turn wants an object. It stops the model
   * wrapping the reply in prose, and nothing more: the schema itself is in the
   * prompt and checked by the service.
   */
  private request(turn: Turn): Request {
    return {
      model: turn.model,
      temperature: turn.temperature,
      max_tokens: turn.maxTokens,
      messages: [
        { role: 'system', content: turn.system },
        { role: 'user', content: turn.user }
      ],
      ...(turn.json ? { response_format: { type: 'json_object' } } : {})
    }
  }

  /** The service decides what to retry by status, so the SDK's own error type stops here. */
  private async guard<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work()
    } catch (error) {
      if (error instanceof OpenAI.APIError) {
        throw new ProviderError(error.message, typeof error.status === 'number' ? error.status : null, error)
      }
      throw error
    }
  }
}
