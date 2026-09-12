/**
 * The microphone lives in the renderer because that is where getUserMedia is,
 * but the key does not: chunks go straight to main and out again. Nothing is
 * recorded, buffered to disk, or kept after it is sent.
 */

/** Small enough that a sentence does not wait on the next chunk. */
const SLICE_MS = 250

export class Mic {
  private stream: MediaStream | null = null
  private recorder: MediaRecorder | null = null
  private readonly onChunk: (chunk: ArrayBuffer) => void
  private readonly onGone: () => void

  constructor(onChunk: (chunk: ArrayBuffer) => void, onGone: () => void) {
    this.onChunk = onChunk
    this.onGone = onGone
  }

  get running(): boolean {
    return this.recorder !== null
  }

  async start(): Promise<void> {
    if (this.recorder) return
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true }
    })
    // A device that goes away mid session is reported, not left as a dead recorder.
    for (const track of this.stream.getTracks()) {
      track.onended = () => {
        this.stop()
        this.onGone()
      }
    }
    const preferred = 'audio/webm;codecs=opus'
    const recorder = new MediaRecorder(
      this.stream,
      MediaRecorder.isTypeSupported(preferred) ? { mimeType: preferred } : {}
    )
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) void event.data.arrayBuffer().then(this.onChunk)
    }
    recorder.start(SLICE_MS)
    this.recorder = recorder
  }

  stop(): void {
    try {
      if (this.recorder && this.recorder.state !== 'inactive') this.recorder.stop()
    } catch {
      // A recorder whose device has already gone throws on stop, and is stopped.
    }
    this.recorder = null
    for (const track of this.stream?.getTracks() ?? []) track.stop()
    this.stream = null
  }
}
