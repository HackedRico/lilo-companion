import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Account } from './sources.ts'

/** A day. The boards move slowly, and asking twice in a session should not fetch twice. */
export const FRESH_MS = 24 * 60 * 60 * 1000

interface Saved {
  fetchedAt: number
  accounts: Account[]
}

/** What was read about a company, kept on disk so the second ask is instant and offline. */
export class AccountCache {
  private readonly dir: string

  constructor(dir: string) {
    this.dir = dir
  }

  private file(company: string): string {
    return join(this.dir, `${company.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}.json`)
  }

  async read(company: string, now = Date.now()): Promise<Account[] | null> {
    try {
      const saved = JSON.parse(await readFile(this.file(company), 'utf8')) as Saved
      if (now - saved.fetchedAt > FRESH_MS) return null
      return saved.accounts
    } catch {
      return null
    }
  }

  async write(company: string, accounts: Account[], now = Date.now()): Promise<void> {
    await mkdir(this.dir, { recursive: true })
    await writeFile(this.file(company), JSON.stringify({ fetchedAt: now, accounts } satisfies Saved))
  }
}
