/**
 * Long enough for a marker holding several ids. Prose is not at risk: anything
 * that is not "[S:" stops being a candidate after three characters.
 */
const MAX_MARKER = 400

/** A range wider than this is the model waving at a source, not citing it. */
const MAX_SPAN = 12

/**
 * "a#0-#2" is three sentences of one account written short. Expanded here and
 * checked against the retriever afterwards, so the shorthand costs nothing and
 * proves nothing on its own.
 */
export function expand(id: string): string[] {
  const range = /^(.*#)(\d+)\s*-\s*#?(\d+)$/.exec(id)
  if (!range) return [id]
  const from = Number(range[2])
  const to = Number(range[3])
  if (to < from || to - from >= MAX_SPAN) return [id]
  const out: string[] = []
  for (let index = from; index <= to; index++) out.push(`${range[1]}${index}`)
  return out
}

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
        // Only "[S:" can be a marker. A bracket in prose is let go at once
        // rather than held until something closes it.
        if (this.buffer.length === 3 && !this.buffer.startsWith('[S:')) {
          out += this.buffer
          this.buffer = ''
        } else if (char === ']') {
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
    // A model crams several ids into one marker, and writes a run of sentences
    // from one source as a range. Each piece is expanded and then checked, so
    // only ids the retriever actually returned survive.
    for (const piece of match[1]!.split(/[,;]/)) {
      for (const id of expand(piece.trim().replace(/^S:\s*/i, ''))) {
        if (this.valid.has(id)) this.cited.push(id)
      }
    }
    // Either way the marker itself is plumbing and never reaches the student.
    return ''
  }
}
