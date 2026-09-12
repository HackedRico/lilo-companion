/**
 * Chrome's native messaging wire: each message is a 32-bit little-endian
 * length and then that many bytes of JSON. Pure, so the host can be tested
 * without Chrome on the other end.
 */

export function encode(message: unknown): Buffer {
  const body = Buffer.from(JSON.stringify(message), 'utf8')
  const head = Buffer.alloc(4)
  head.writeUInt32LE(body.length, 0)
  return Buffer.concat([head, body])
}

/** Chunks arrive split anywhere, so what is not yet a whole message waits. */
export class Decoder {
  private buffer: Buffer = Buffer.alloc(0)

  push(chunk: Buffer): unknown[] {
    this.buffer = Buffer.concat([this.buffer, chunk])
    const out: unknown[] = []
    while (this.buffer.length >= 4) {
      const length = this.buffer.readUInt32LE(0)
      if (this.buffer.length < 4 + length) break
      const body = this.buffer.subarray(4, 4 + length).toString('utf8')
      this.buffer = this.buffer.subarray(4 + length)
      try {
        out.push(JSON.parse(body))
      } catch {
        // A frame that is not JSON is dropped; the length prefix keeps the stream aligned.
      }
    }
    return out
  }
}
