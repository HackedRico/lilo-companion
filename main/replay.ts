import { readFile } from 'node:fs/promises'

/**
 * A saved lecture, fed in as if it were being spoken, so the loop can run with
 * no microphone and no network in the room.
 */
export class Replay {
  private timer: ReturnType<typeof setInterval> | null = null
  private chunks: string[] = []
  private next = 0

  private readonly onLine: (text: string) => void
  private readonly onEnd: () => void

  constructor(onLine: (text: string) => void, onEnd: () => void) {
    this.onLine = onLine
    this.onEnd = onEnd
  }

  async load(path: string): Promise<number> {
    const text = await readFile(path, 'utf8')
    this.chunks = text
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
    this.next = 0
    return this.chunks.length
  }

  get running(): boolean {
    return this.timer !== null
  }

  /** A line every few seconds stands in for a lecturer talking. */
  start(everyMs = 4000): void {
    this.stop()
    this.timer = setInterval(() => {
      const chunk = this.chunks[this.next]
      if (chunk === undefined) {
        this.stop()
        this.onEnd()
        return
      }
      this.next++
      this.onLine(chunk)
    }, everyMs)
  }

  stop(): void {
    if (!this.timer) return
    clearInterval(this.timer)
    this.timer = null
  }
}
