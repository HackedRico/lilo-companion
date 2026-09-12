import { LONGEST_MS, SPEECH_RATE, isSilent, wavOf } from '../../shared/voice.ts'

/**
 * The microphone, from a press to a WAV. Chromium records webm, and no two
 * transcription servers agree on reading it, so what was heard is decoded
 * here and resampled to the one format they all read. The words themselves
 * come from main: the renderer never sees an address or a key.
 */
export class Dictation {
  private recorder: MediaRecorder | null = null
  private chunks: Blob[] = []
  private timer: ReturnType<typeof setTimeout> | undefined
  /** False from the moment a cancel lands, which can be while the OS is still asking. */
  private wanted = false
  /** The mic runs out on its own, so a press nobody released still ends. */
  onTimeout: (() => void) | null = null

  get live(): boolean {
    return this.recorder !== null
  }

  /**
   * Opens the microphone, which is the OS's prompt the first time. False when
   * the opening was cancelled before the OS answered, in which case nothing
   * is recording.
   */
  async start(): Promise<boolean> {
    if (this.recorder) return true
    this.wanted = true
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
    })
    // Voice mode went off, or the panel closed, while the OS was still asking.
    if (!this.wanted) {
      for (const track of stream.getTracks()) track.stop()
      return false
    }
    const recorder = new MediaRecorder(stream)
    this.chunks = []
    recorder.ondataavailable = (event): void => {
      if (event.data.size > 0) this.chunks.push(event.data)
    }
    recorder.start()
    this.recorder = recorder
    this.timer = setTimeout(() => this.onTimeout?.(), LONGEST_MS)
    return true
  }

  /** What was said since start, as a WAV, or null when nothing was. */
  async stop(): Promise<ArrayBuffer | null> {
    const encoded = await this.finish()
    if (!encoded || encoded.byteLength === 0) return null
    const samples = await speechOf(encoded)
    return samples && !isSilent(samples) ? wavOf(samples) : null
  }

  /** Stops and throws it away: voice mode turned off mid sentence, or the panel closing. */
  cancel(): void {
    void this.finish()
  }

  private finish(): Promise<ArrayBuffer | null> {
    const recorder = this.recorder
    clearTimeout(this.timer)
    this.wanted = false
    this.recorder = null
    if (!recorder) return Promise.resolve(null)
    return new Promise((resolve) => {
      const done = (): void => {
        for (const track of recorder.stream.getTracks()) track.stop()
        void new Blob(this.chunks, { type: recorder.mimeType }).arrayBuffer().then(resolve)
      }
      // A microphone unplugged mid sentence has already stopped the recorder.
      if (recorder.state === 'inactive') return done()
      recorder.onstop = done
      recorder.stop()
    })
  }
}

/** Decoded and resampled to mono at the speech rate, or null when it cannot be read. */
async function speechOf(encoded: ArrayBuffer): Promise<Float32Array | null> {
  const context = new AudioContext()
  try {
    const decoded = await context.decodeAudioData(encoded)
    const offline = new OfflineAudioContext(1, Math.ceil(decoded.duration * SPEECH_RATE), SPEECH_RATE)
    const source = offline.createBufferSource()
    source.buffer = decoded
    source.connect(offline.destination)
    source.start()
    return (await offline.startRendering()).getChannelData(0)
  } catch {
    return null
  } finally {
    void context.close()
  }
}

/** Why the microphone did not open, said for the OS the student is on. */
export function micTrouble(error: unknown, platform: string): string {
  const name = error instanceof DOMException ? error.name : ''
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return platform === 'darwin'
      ? 'Lilo has no microphone access. Allow it under System Settings, Privacy & Security, Microphone.'
      : 'Lilo has no microphone access. Allow it under Settings, Privacy & security, Microphone.'
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'No microphone on this machine.'
  if (name === 'NotReadableError') return 'Another app is holding the microphone.'
  return 'I could not open the microphone.'
}
