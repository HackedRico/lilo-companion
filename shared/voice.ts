/**
 * Speech, from the microphone to the words. The renderer records and hands
 * over one WAV; main sends it to be transcribed and hands back the words, or
 * the reason there are none. Nothing here touches a device or the wire.
 */

/** What every transcription server reads: mono, 16 bits, at whisper's own rate. */
export const SPEECH_RATE = 16000

/** A press of the mic stops itself here, so one nobody released still ends. */
export const LONGEST_MS = 120_000

/** OpenAI's own ceiling, and far past what LONGEST_MS at SPEECH_RATE can make. */
export const LOUDEST_BYTES = 25 * 1024 * 1024

/** Below this peak the recording is the room, and sending it invents words. */
const QUIET = 0.01

/** What came back from the transcriber. A refusal is a line, never a throw. */
export type Heard = { ok: true; text: string } | { ok: false; detail: string }

/** True when nothing was said. Whisper hears a "Thank you." in silence. */
export function isSilent(samples: Float32Array): boolean {
  let peak = 0
  for (const sample of samples) peak = Math.max(peak, Math.abs(sample))
  return peak < QUIET
}

/**
 * A 16-bit PCM WAV, the one format every transcription server reads with no
 * ffmpeg beside it. The header is 44 bytes of RIFF, written by hand because
 * that is shorter than any library that writes it.
 */
export function wavOf(samples: Float32Array, rate = SPEECH_RATE): ArrayBuffer {
  const bytes = new ArrayBuffer(44 + samples.length * 2)
  const view = new DataView(bytes)
  const ascii = (at: number, text: string): void => {
    for (let i = 0; i < text.length; i++) view.setUint8(at + i, text.charCodeAt(i))
  }
  ascii(0, 'RIFF')
  view.setUint32(4, 36 + samples.length * 2, true)
  ascii(8, 'WAVE')
  ascii(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true) // PCM
  view.setUint16(22, 1, true) // one channel
  view.setUint32(24, rate, true)
  view.setUint32(28, rate * 2, true) // bytes a second
  view.setUint16(32, 2, true) // bytes a frame
  view.setUint16(34, 16, true) // bits a sample
  ascii(36, 'data')
  view.setUint32(40, samples.length * 2, true)
  for (let i = 0; i < samples.length; i++) {
    const clipped = Math.max(-1, Math.min(1, samples[i] ?? 0))
    view.setInt16(44 + i * 2, clipped < 0 ? clipped * 0x8000 : clipped * 0x7fff, true)
  }
  return bytes
}
