import OpenAI, { toFile } from 'openai'
import { z } from 'zod'
import type { Heard } from '../shared/voice.ts'
import { REQUEST_TIMEOUT_MS } from './llm/provider.ts'
import { isLocal } from './llm/service.ts'

/**
 * Where speech is sent. The same shape as a model, an address, a key and a
 * name, and the student types all three or none of them. With none typed it
 * is the model's own address, since OpenAI's and Groq's both transcribe there.
 */
export interface VoiceConfig {
  baseUrl: string
  apiKey: string
  model: string
}

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

  get available(): boolean {
    const { baseUrl, apiKey } = this.config
    return baseUrl.length > 0 && (apiKey.length > 0 || isLocal(baseUrl))
  }

  async hear(wav: Uint8Array): Promise<Heard> {
    if (!this.config.baseUrl) {
      return { ok: false, detail: 'No address to send speech to. Set a model, or a voice address, in Settings.' }
    }
    if (!this.available) return { ok: false, detail: 'That address is not on this machine, so it wants a key.' }
    const client = new OpenAI({
      // Local servers ignore it, and the client refuses to start without one.
      apiKey: this.config.apiKey || 'local',
      baseURL: this.config.baseUrl,
      maxRetries: 0,
      timeout: REQUEST_TIMEOUT_MS,
      fetch: this.fetch
    })
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
      return { ok: false, detail: reasonFor(error) }
    }
  }
}

/** Turns the endpoint's own wording into something worth reading. */
function reasonFor(error: unknown): string {
  // The client wraps a dead socket and a timeout in its own classes, with the
  // cause underneath, so the class is what says which.
  if (error instanceof OpenAI.APIConnectionTimeoutError) return 'The transcriber did not answer in time.'
  if (error instanceof OpenAI.APIConnectionError) return 'Nothing answered at the voice address.'
  const status = error instanceof OpenAI.APIError && typeof error.status === 'number' ? error.status : null
  const message = error instanceof Error ? error.message : String(error)
  if (status === 401 || status === 403) return 'That key was refused.'
  if (status === 404 && /model/i.test(message)) return 'No model by that name at that address.'
  if (status === 404) return 'Nothing at that address transcribes. Point Voice at a whisper server in Settings.'
  if (status === 413) return 'That was too long for the transcriber.'
  if (status === 429 || status === 503) return 'The transcriber asked for a pause. Try again in a moment.'
  if (/timeout|ETIMEDOUT|aborted/i.test(message)) return 'The transcriber did not answer in time.'
  if (/ECONNREFUSED|fetch failed|ENOTFOUND/i.test(message)) return 'Nothing answered at the voice address.'
  return message.slice(0, 200)
}
