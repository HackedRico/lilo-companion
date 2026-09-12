import { appendFile, mkdir, readFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { workEvent, type WorkEvent } from '../../shared/leetcode.ts'

/**
 * A session on the page is a list of events, so it is written as one, a JSON
 * object per line. A recording replays through the whole practice with no
 * browser present, which is how its manners get tuned.
 */
export class Recorder {
  private readonly path: string
  private ready: Promise<void> | null = null

  constructor(path: string) {
    this.path = path
  }

  async write(event: WorkEvent): Promise<void> {
    this.ready ??= mkdir(dirname(this.path), { recursive: true }).then(() => undefined)
    await this.ready
    await appendFile(this.path, `${JSON.stringify(event)}\n`)
  }
}

/** Lines that are not events are skipped rather than stopping the replay. */
export function parseRecording(text: string): WorkEvent[] {
  const events: WorkEvent[] = []
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue
    try {
      const parsed = workEvent.safeParse(JSON.parse(line))
      if (parsed.success) events.push(parsed.data)
    } catch {
      // Not JSON, so not an event.
    }
  }
  return events
}

export async function readRecording(path: string): Promise<WorkEvent[]> {
  return parseRecording(await readFile(path, 'utf8'))
}

/**
 * Plays events back with the gaps they were recorded with, capped so a real
 * hour of work replays in a minute. Timestamps are rewritten to now, so the
 * practice sees them the way it saw the live session.
 */
export async function replay(
  events: WorkEvent[],
  observe: (event: WorkEvent) => Promise<void>,
  options: { maxGapMs?: number; now?: () => number } = {}
): Promise<void> {
  const maxGap = options.maxGapMs ?? 2000
  const now = options.now ?? Date.now
  let previous: number | null = null
  for (const event of events) {
    const gap = previous === null ? 0 : Math.min(maxGap, Math.max(0, event.at - previous))
    previous = event.at
    if (gap > 0) await new Promise((resolve) => setTimeout(resolve, gap))
    await observe({ ...event, at: now() })
  }
}
