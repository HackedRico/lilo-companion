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
 * Everything the app may say to the extension: a mark on the student's lines,
 * and a request to say again what is open. The second exists because a page
 * that has not changed reports nothing, so an app that started after the tab
 * did would otherwise never learn which problem is on it.
 */
export type ToPage = { mark: Mark } | { resync: true }

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
    for (const client of this.clients) write(client, message)
  }

  close(): void {
    for (const client of this.clients) client.destroy()
    this.clients.clear()
    this.server.close()
  }

  private accept(socket: Socket): void {
    this.clients.add(socket)
    // A restart of the app leaves the tab sitting there with nothing to report,
    // and the practice stays empty however much the student edits: the hints
    // all answer "nothing open". So the first thing said down a fresh line is a
    // request for the page to say again what is on it.
    write(socket, { resync: true })
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

function write(socket: Socket, message: ToPage): void {
  socket.write(`${JSON.stringify(message)}\n`)
}
