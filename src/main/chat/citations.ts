/** Long enough for any real marker, short enough that prose is never swallowed. */
const MAX_MARKER = 120

/**
 * Pulls [S:id] markers out of a stream as it arrives, so the student never sees
 * the plumbing, and drops any id the retriever did not actually return this
 * turn, so the companion cannot cite a posting it never read.
 */
export class CitationFilter {
  private buffer = ''
  private readonly cited: string[] = []

  private readonly valid: Set<string>

  constructor(valid: Set<string>) {
    this.valid = valid
  }

  push(token: string): string {
    let out = ''
    for (const char of token) {
      if (this.buffer) {
        this.buffer += char
        if (char === ']') {
          out += this.settle()
        } else if (this.buffer.length > MAX_MARKER) {
          out += this.buffer
          this.buffer = ''
        }
        continue
      }
      if (char === '[') this.buffer = char
      else out += char
    }
    return out
  }

  /** Anything still buffered was never a marker, so it is prose after all. */
  flush(): string {
    const rest = this.buffer
    this.buffer = ''
    return rest
  }

  get citations(): string[] {
    return [...new Set(this.cited)]
  }

  private settle(): string {
    const marker = this.buffer
    this.buffer = ''
    const match = /^\[S:\s*([^\]]+?)\s*\]$/.exec(marker)
    if (!match) return marker
    const id = match[1]!
    if (this.valid.has(id)) this.cited.push(id)
    // Either way the marker itself is plumbing and never reaches the student.
    return ''
  }
}
