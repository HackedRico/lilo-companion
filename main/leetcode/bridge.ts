import { createHash } from 'node:crypto'
import { unlink } from 'node:fs/promises'
import { createServer, type Server, type Socket } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { workEvent, type Mark, type WorkEvent } from '../../shared/leetcode.ts'

/**
 * Where the native host finds the running app. A named pipe on Windows. A
 * socket file elsewhere, in the temp directory rather than beside the
 * settings, because a socket path is capped near a hundred characters and a
 * user data directory can be longer than that on its own.
 */
export function bridgePath(userData: string, platform: NodeJS.Platform = process.platform): string {
  const hash = createHash('sha256').update(userData).digest('hex').slice(0, 12)
  return platform === 'win32' ? `\\\\.\\pipe\\lilo-${hash}` : join(tmpdir(), `lilo-${hash}.sock`)
}

/**
 * The app's end of the line to Chrome. Events arrive one JSON object per
 * line and are validated before anything downstream sees them; the only thing
 * that goes back is a mark on the student's editor.
 */
export class Bridge {
  private readonly path: string
  private readonly onEvent: (event: WorkEvent) => void
  private readonly server: Server
  private readonly clients = new Set<Socket>()
  lastEventAt: number | null = null

  constructor(path: string, onEvent: (event: WorkEvent) => void) {
    this.path = path
    this.onEvent = onEvent
    this.server = createServer((socket) => this.accept(socket))
  }

  async listen(): Promise<void> {
    // A socket file left by a crash would refuse the bind; a pipe name cannot be unlinked.
    if (!this.path.startsWith('\\\\.\\pipe\\')) await unlink(this.path).catch(() => undefined)
    await new Promise<void>((resolve, reject) => {
      this.server.once('error', reject)
      this.server.listen(this.path, () => {
        this.server.off('error', reject)
        resolve()
      })
    })
  }

  get connected(): boolean {
    return this.clients.size > 0
  }

  send(message: { mark: Mark }): void {
    const line = `${JSON.stringify(message)}\n`
    for (const client of this.clients) client.write(line)
  }

  close(): void {
    for (const client of this.clients) client.destroy()
    this.clients.clear()
    this.server.close()
  }

  private accept(socket: Socket): void {
    this.clients.add(socket)
    let pending = ''
    socket.on('data', (chunk: Buffer) => {
      pending += chunk.toString('utf8')
      const lines = pending.split('\n')
      pending = lines.pop() ?? ''
      for (const line of lines) this.take(line)
    })
    const drop = (): void => void this.clients.delete(socket)
    socket.on('close', drop)
    socket.on('error', drop)
  }

  private take(line: string): void {
    if (!line.trim()) return
    let parsed: unknown
    try {
      parsed = JSON.parse(line)
    } catch {
      return
    }
    const event = workEvent.safeParse((parsed as { event?: unknown } | null)?.event)
    if (!event.success) return
    this.lastEventAt = Date.now()
    this.onEvent(event.data)
  }
}
