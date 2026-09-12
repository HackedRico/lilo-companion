import { toFile } from 'openai'
import { z } from 'zod'
import { LONGEST_MS, type Heard } from '../shared/voice.ts'
import { asProviderError, openAiClient } from './llm/openai.ts'
import { ProviderError, REQUEST_TIMEOUT_MS, reasonFor } from './llm/provider.ts'

/**
 * Where speech is sent. The same shape as a model, an address, a key and a
 * name, and the student types all three or none of them. With none typed it
 * is the model's own address, where that address speaks the OpenAI API.
 */
export interface VoiceConfig {
  baseUrl: string
  apiKey: string
  model: string
}

/**
 * A clip may run to LONGEST_MS, and on a slow uplink the upload alone can
 * take as long again before the model starts, so the transcriber waits
 * longer than a chat turn does. The mic button is the only thing waiting.
 */
export const VOICE_TIMEOUT_MS = REQUEST_TIMEOUT_MS + LONGEST_MS

/** The one field every server puts in its reply, whatever else it adds. */
const transcription = z.object({ text: z.string() })

/**
 * One WAV in, the words out, over the OpenAI audio API, which is what every
 * hosted service and every whisper server speaks. It never throws: a refusal
 * comes back as a line the composer can show, the way the model's connection
 * test does. It does not wait behind the model's queue, because the student is
 * standing there with a sentence in the air.
 */
export class Transcriber {
  private config: VoiceConfig
  private readonly fetch: typeof globalThis.fetch | undefined

  constructor(config: VoiceConfig, fetch?: typeof globalThis.fetch) {
    this.config = config
    this.fetch = fetch
  }

  reconfigure(config: VoiceConfig): void {
    this.config = config
  }

  /** An address is all it takes. Whether that address wants a key is the address's to say. */
  get available(): boolean {
    return this.config.baseUrl.length > 0
  }

  async hear(wav: Uint8Array): Promise<Heard> {
    if (!this.available) {
      return { ok: false, detail: 'No address to send speech to. Set a voice address in Settings.' }
    }
    const client = openAiClient(this.config, { fetch: this.fetch, timeout: VOICE_TIMEOUT_MS })
    try {
      const reply = await client.audio.transcriptions.create({
        file: await toFile(wav, 'speech.wav', { type: 'audio/wav' }),
        model: this.config.model,
        response_format: 'json'
      })
      const parsed = transcription.safeParse(reply)
      if (!parsed.success) return { ok: false, detail: 'The transcriber answered with no words in it.' }
      const text = parsed.data.text.trim()
      return text ? { ok: true, text } : { ok: false, detail: 'I heard nothing in that.' }
    } catch (error) {
      return { ok: false, detail: this.reason(asProviderError(error)) }
    }
  }

  /** What the transcriber knows better than the shared reading: a missing key, and what a 404 means here. */
  private reason(error: unknown): string {
    const status = error instanceof ProviderError ? error.status : null
    const message = error instanceof Error ? error.message : ''
    if ((status === 401 || status === 403) && !this.config.apiKey) {
      return 'That address wants a key. Add one under Settings, Model, Voice.'
    }
    if (status === 404 && !/model/i.test(message)) {
      return 'Nothing at that address transcribes. Point Voice at a whisper server in Settings.'
    }
    return reasonFor(error, 'The transcriber')
  }
}
