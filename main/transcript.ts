/** The rolling window the pipeline reads. Nothing here is ever written to disk. */
export class Transcript {
  private readonly lines: { at: number; text: string }[] = []

  append(text: string, at = Date.now()): void {
    const trimmed = text.trim()
    if (trimmed) this.lines.push({ at, text: trimmed })
  }

  /** The last few minutes, which is what a concept is extracted from. */
  window(ms = 180000, now = Date.now()): string {
    const cutoff = now - ms
    const recent = this.lines.filter((line) => line.at >= cutoff)
    return (recent.length > 0 ? recent : this.lines.slice(-6)).map((line) => line.text).join(' ')
  }

  get all(): string {
    return this.lines.map((line) => line.text).join(' ')
  }

  get empty(): boolean {
    return this.lines.length === 0
  }

  /** Called when a session ends. Transcripts do not outlive the recap. */
  clear(): void {
    this.lines.length = 0
  }
}
