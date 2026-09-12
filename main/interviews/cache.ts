import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import { account, type Account } from './sources.ts'

/** A day. The boards move slowly, and asking twice in a session should not fetch twice. */
export const FRESH_MS = 24 * 60 * 60 * 1000

const saved = z.object({ fetchedAt: z.number(), accounts: z.array(account) })

type Saved = z.infer<typeof saved>

/**
 * What was read about a company, kept in memory for the session and on disk
 * for a day, so the second ask is instant and works offline. A file that
 * does not parse as accounts is a miss, never a crash.
 */
export class AccountCache {
  private readonly dir: string
  private readonly held = new Map<string, Saved>()
  private ready: Promise<void> | null = null

  constructor(dir: string) {
    this.dir = dir
  }

  private key(company: string): string {
    return company.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  }

  async read(company: string, now = Date.now()): Promise<Account[] | null> {
    const key = this.key(company)
    const entry = this.held.get(key) ?? (await this.load(key))
    if (!entry || now - entry.fetchedAt > FRESH_MS) return null
    return entry.accounts
  }

  async write(company: string, accounts: Account[], now = Date.now()): Promise<void> {
    const key = this.key(company)
    const entry = { fetchedAt: now, accounts }
    this.held.set(key, entry)
    this.ready ??= mkdir(this.dir, { recursive: true }).then(() => undefined)
    await this.ready
    await writeFile(join(this.dir, `${key}.json`), JSON.stringify(entry))
  }

  private async load(key: string): Promise<Saved | null> {
    try {
      const parsed = saved.safeParse(JSON.parse(await readFile(join(this.dir, `${key}.json`), 'utf8')))
      if (!parsed.success) return null
      this.held.set(key, parsed.data)
      return parsed.data
    } catch {
      return null
    }
  }
}
