import { AnthropicProvider } from './anthropic.ts'
import { OpenAiProvider } from './openai.ts'
import type { Provider } from './provider.ts'
import type { LlmConfig } from './service.ts'

/**
 * The provider that speaks a configuration's protocol. This is the only place
 * a protocol name meets a class, so a new protocol is a file and a line here.
 */
export function providerFor(config: LlmConfig): Provider {
  const endpoint = { baseUrl: config.baseUrl, apiKey: config.apiKey }
  switch (config.protocol) {
    case 'anthropic':
      return new AnthropicProvider(endpoint)
    case 'openai':
      return new OpenAiProvider(endpoint)
  }
}
