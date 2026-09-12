/**
 * The lecture in front of the student. A lecture arrives whole, as a file or a
 * paste, and a new one replaces the last: it is a document they are working
 * from, not a stream they are part way through. Nothing here is ever written
 * to disk.
 */
export class Transcript {
  private current: { at: number; text: string } | null = null

  /** A lecture handed over. Whatever came before it is no longer what they mean. */
  take(text: string, at = Date.now()): void {
    const trimmed = text.trim()
    if (trimmed) this.current = { at, text: trimmed }
  }

  /** What a concept is extracted from, and what chat reads for context. */
  window(): string {
    return this.current?.text ?? ''
  }

  get empty(): boolean {
    return this.current === null
  }

  /** Called when a session ends. Transcripts do not outlive the recap. */
  clear(): void {
    this.current = null
  }
}
