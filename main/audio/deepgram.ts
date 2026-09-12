import { DeepgramClient } from '@deepgram/sdk'
import type { listen } from '@deepgram/sdk'

type Socket = Awaited<ReturnType<DeepgramClient['listen']['v1']['connect']>>

/**
 * Live transcription. Audio arrives from the renderer as webm/opus chunks, goes
 * straight out to Deepgram, and is never written anywhere. The key stays here.
 */
export class Listener {
  private key: string
  private readonly onFinal: (text: string) => void
  private readonly onTrouble: (reason: string) => void
  private socket: Socket | null = null
  private ready = false
  private connecting = false
  /** Set by stop(), so the close that follows is not reported as a dropped line. */
  private closing = false

  constructor(key: string, onFinal: (text: string) => void, onTrouble: (reason: string) => void) {
    this.key = key
    this.onFinal = onFinal
    this.onTrouble = onTrouble
  }

  get available(): boolean {
    return this.key.length > 0
  }

  /** A key changed in the preferences window takes effect on the next listen. */
  setKey(key: string): void {
    if (key === this.key) return
    this.key = key
    this.stop()
  }

  get open(): boolean {
    return this.ready
  }

  async start(): Promise<void> {
    if (!this.available || this.socket || this.connecting) return
    this.connecting = true
    this.closing = false
    try {
      const socket = await new DeepgramClient({ apiKey: this.key }).listen.v1.connect({
        model: 'nova-3',
        language: 'en',
        // No encoding or sample rate: the container says what the audio is.
        // These ride in the query string, so the SDK takes them as strings.
        smart_format: 'true',
        punctuate: 'true',
        interim_results: 'false',
        endpointing: 400,
        Authorization: `Token ${this.key}`
      })
      socket.on('open', () => {
        this.ready = true
      })
      socket.on('message', (message) => {
        const text = transcriptOf(message)
        if (text) this.onFinal(text)
      })
      socket.on('error', (error: Error) => {
        this.ready = false
        this.onTrouble(error.message)
      })
      socket.on('close', () => {
        const wasReady = this.ready
        this.ready = false
        this.socket = null
        // A close the app did not ask for is a dropped line, and the student
        // should hear that rather than watch a ring listening to nothing.
        if (wasReady && !this.closing) this.onTrouble('the connection closed')
      })
      this.socket = socket
    } catch (error) {
      this.onTrouble((error as Error).message)
    } finally {
      this.connecting = false
    }
  }

  send(chunk: Uint8Array): void {
    if (!this.ready || !this.socket) return
    try {
      this.socket.sendMedia(chunk)
    } catch {
      // A chunk that misses the socket is a quarter second of lecture, not a bug.
    }
  }

  stop(): void {
    this.closing = true
    this.ready = false
    const socket = this.socket
    this.socket = null
    try {
      socket?.close()
    } catch {
      // A connection that is already gone needs no closing.
    }
  }
}

function transcriptOf(message: unknown): string {
  const results = message as Partial<listen.ListenV1Results>
  if (results.type !== 'Results' || results.is_final === false) return ''
  return (results.channel?.alternatives?.[0]?.transcript ?? '').trim()
}
