import { LONGEST_MS, SPEECH_RATE, isSilent, wavOf } from '../../shared/voice.ts'

/** One press of the mic: the recorder, and what it has handed over so far. */
interface Take {
  recorder: MediaRecorder
  chunks: Blob[]
}

/**
 * The microphone, from a press to a WAV. Chromium records webm, and no two
 * transcription servers agree on reading it, so what was heard is decoded
 * here and resampled to the one format they all read. The words themselves
 * come from main: the renderer never sees an address or a key.
 */
export class Dictation {
  private take: Take | null = null
  private timer: ReturnType<typeof setTimeout> | undefined
  /** False from the moment a cancel lands, which can be while the OS is still asking. */
  private wanted = false
  /** The mic runs out on its own, so a press nobody released still ends. */
  onTimeout: (() => void) | null = null

  /**
   * Opens the microphone, which is the OS's prompt the first time. False when
   * the opening was cancelled before the OS answered, in which case nothing
   * is recording.
   */
  async start(): Promise<boolean> {
    if (this.take) return true
    this.wanted = true
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
    })
    // Voice mode went off, or the panel closed, while the OS was still asking.
    if (!this.wanted) {
      for (const track of stream.getTracks()) track.stop()
      return false
    }
    const take: Take = { recorder: new MediaRecorder(stream), chunks: [] }
    // Bound to this take, so a chunk a cancelled recorder hands over late
    // lands in its own list and not in the next recording's.
    take.recorder.ondataavailable = (event): void => {
      if (event.data.size > 0) take.chunks.push(event.data)
    }
    take.recorder.start()
    this.take = take
    this.timer = setTimeout(() => this.onTimeout?.(), LONGEST_MS)
    return true
  }

  /**
   * What was said since start, as a WAV, or null when nothing was. Throws
   * when what was recorded cannot be read, which is a different thing from
   * silence and is said differently.
   */
  async stop(): Promise<ArrayBuffer | null> {
    const encoded = await this.finish(true)
    if (!encoded || encoded.byteLength === 0) return null
    const { samples, rate } = await speechOf(encoded)
    return isSilent(samples) ? null : wavOf(samples, rate)
  }

  /** Stops and throws it away: voice mode turned off mid sentence, or the panel closing. */
  cancel(): void {
    this.finish(false).catch(() => undefined)
  }

  /** Ends the take. With `keep`, resolves to what it recorded; without, reads nothing. */
  private finish(keep: boolean): Promise<ArrayBuffer | null> {
    const take = this.take
    clearTimeout(this.timer)
    this.wanted = false
    this.take = null
    if (!take) return Promise.resolve(null)
    return new Promise((resolve, reject) => {
      const done = (): void => {
        for (const track of take.recorder.stream.getTracks()) track.stop()
        if (!keep) return resolve(null)
        new Blob(take.chunks, { type: take.recorder.mimeType }).arrayBuffer().then(resolve, reject)
      }
      // A microphone unplugged mid sentence has already stopped the recorder.
      if (take.recorder.state === 'inactive') return done()
      take.recorder.onstop = done
      try {
        take.recorder.stop()
      } catch {
        // It went inactive between the check and the call. Same thing.
        done()
      }
    })
  }
}

/**
 * Decoded and resampled to mono at the speech rate. An offline context does
 * both without opening an output device: decoding resamples to the context's
 * own rate, and a stereo take is averaged down by hand. The rate comes back
 * with the samples so the WAV header says what was actually done.
 */
async function speechOf(encoded: ArrayBuffer): Promise<{ samples: Float32Array; rate: number }> {
  const decoded = await new OfflineAudioContext(1, 1, SPEECH_RATE).decodeAudioData(encoded)
  const rate = decoded.sampleRate
  if (decoded.numberOfChannels === 1) return { samples: decoded.getChannelData(0), rate }
  const samples = new Float32Array(decoded.length)
  for (let channel = 0; channel < decoded.numberOfChannels; channel++) {
    const data = decoded.getChannelData(channel)
    for (let i = 0; i < samples.length; i++) samples[i] = (samples[i] ?? 0) + (data[i] ?? 0) / decoded.numberOfChannels
  }
  return { samples, rate }
}

/** Why the microphone did not open, said for the OS the student is on. */
export function micTrouble(error: unknown, platform: string): string {
  const name = error instanceof Error ? error.name : ''
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    const where = platform === 'darwin' ? 'System Settings, Privacy & Security' : 'Settings, Privacy & security'
    return `Lilo has no microphone access. Allow it under ${where}, Microphone.`
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'No microphone on this machine.'
  if (name === 'NotReadableError') return 'Another app is holding the microphone.'
  return 'I could not open the microphone.'
}
