import Anthropic from '@anthropic-ai/sdk'
import { ProviderError, REQUEST_TIMEOUT_MS, type Endpoint, type Provider, type Turn } from './provider.ts'

/** Claude, through the messages API, at api.anthropic.com or a gateway in front of it. */
export class AnthropicProvider implements Provider {
  private readonly client: Anthropic

  constructor(endpoint: Endpoint, fetch?: typeof globalThis.fetch) {
    this.client = new Anthropic({
      // A gateway on this machine may want none, and the client refuses to start without one.
      apiKey: endpoint.apiKey || 'local',
      baseURL: endpoint.baseUrl,
      maxRetries: 0,
      timeout: REQUEST_TIMEOUT_MS,
      fetch
    })
  }

  async complete(turn: Turn): Promise<string> {
    const message = await this.guard(() => this.client.messages.create(this.request(turn)))
    // A decline arrives as a normal reply with nothing usable in it.
    if (message.stop_reason === 'refusal') throw new ProviderError('The model declined to answer that.', null)
    return message.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('')
  }

  async stream(turn: Turn, onToken: (token: string) => void): Promise<string> {
    return this.guard(async () => {
      const stream = this.client.messages.stream(this.request(turn))
      let text = ''
      for await (const event of stream) {
        if (event.type !== 'content_block_delta' || event.delta.type !== 'text_delta') continue
        text += event.delta.text
        onToken(event.delta.text)
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
   * No temperature: current Claude models refuse sampling parameters. No JSON
   * mode either: the schema is stated in the prompt and checked by the
   * service, which is how every protocol is treated.
   */
  private request(turn: Turn): Anthropic.MessageCreateParamsNonStreaming {
    return {
      model: turn.model,
      max_tokens: turn.maxTokens,
      system: turn.system,
      messages: [{ role: 'user', content: turn.user }]
    }
  }

  /** The service decides what to retry by status, so the SDK's own error type stops here. */
  private async guard<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work()
    } catch (error) {
      if (error instanceof Anthropic.APIError) {
        throw new ProviderError(error.message, typeof error.status === 'number' ? error.status : null, error)
      }
      throw error
    }
  }
}
