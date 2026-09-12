import type { ConnectionResult, SettingsPatch, SettingsView } from '../shared/settings.ts'
import { maskKey } from '../shared/settings.ts'
import { FALLBACK, isLocal, normaliseBaseUrl, type LlmConfig } from './llm/provider.ts'
import type { SavedSettings } from './store.ts'

/** All this needs of the preferences file, so a test can stand in for it. */
export interface SettingsHome {
  settings: SavedSettings
}

/** Where secrets are held. Kept behind an interface so the rules can be tested. */
export interface Keychain {
  readonly available: boolean
  seal(value: string): string
  open(sealed: string): string
}

type Secret = 'apiKey' | 'deepgramKey'

/**
 * Reads the address, the key and the two model names from .env. There is no
 * provider here either: an endpoint is a URL, and anything blank falls through
 * to the defaults.
 */
function configFromEnv(env: NodeJS.ProcessEnv = process.env): LlmConfig {
  return {
    baseUrl: normaliseBaseUrl(env['LLM_BASE_URL'] || FALLBACK.baseUrl),
    apiKey: env['LLM_API_KEY'] || '',
    fast: env['MODEL_FAST'] || FALLBACK.fast,
    strong: env['MODEL_STRONG'] || FALLBACK.strong
  }
}

/**
 * What the student chose, layered over what the developer put in .env. A field
 * they have never touched falls through to the environment, so a checkout with
 * a .env still works with nothing configured in the window.
 */
export class SettingsStore {
  private readonly prefs: SettingsHome
  private readonly env: NodeJS.ProcessEnv
  private readonly keychain: Keychain

  constructor(prefs: SettingsHome, keychain: Keychain, env: NodeJS.ProcessEnv = process.env) {
    this.prefs = prefs
    this.keychain = keychain
    this.env = env
  }

  private get saved(): SavedSettings {
    return this.prefs.settings
  }

  /** Keys live in the OS keychain where there is one, and never leave main. */
  private stored(which: Secret): string {
    const value = this.saved[which]
    if (!value) return ''
    if (!value.startsWith('enc:')) return value
    try {
      return this.keychain.open(value.slice(4))
    } catch {
      // A key sealed by a keychain that is no longer there is simply gone.
      return ''
    }
  }

  private fromEnv(which: Secret): string {
    return which === 'apiKey'
      ? configFromEnv(this.env).apiKey
      : (this.env['DEEPGRAM_API_KEY'] ?? '')
  }

  private resolve(which: Secret): { value: string; fromEnv: boolean } {
    const chosen = this.stored(which)
    if (chosen) return { value: chosen, fromEnv: false }
    return { value: this.fromEnv(which), fromEnv: true }
  }

  get apiKey(): string {
    return this.resolve('apiKey').value
  }

  get deepgramKey(): string {
    return this.resolve('deepgramKey').value
  }

  llmConfig(): LlmConfig {
    const env = configFromEnv(this.env)
    return {
      baseUrl: normaliseBaseUrl(this.saved.baseUrl || env.baseUrl),
      apiKey: this.apiKey,
      fast: this.saved.modelFast || env.fast,
      strong: this.saved.modelStrong || env.strong
    }
  }

  view(): SettingsView {
    const config = this.llmConfig()
    const key = this.resolve('apiKey')
    const deepgram = this.resolve('deepgramKey')
    const env = configFromEnv(this.env)
    return {
      baseUrl: config.baseUrl,
      modelFast: config.fast,
      modelStrong: config.strong,
      apiKey: { ...maskKey(key.value), fromEnv: key.fromEnv && key.value.length > 0 },
      deepgramKey: { ...maskKey(deepgram.value), fromEnv: deepgram.fromEnv && deepgram.value.length > 0 },
      encrypted: this.keychain.available,
      local: isLocal(config.baseUrl),
      defaults: { baseUrl: env.baseUrl, modelFast: env.fast, modelStrong: env.strong }
    }
  }

  apply(patch: SettingsPatch): void {
    const next: SavedSettings = { ...this.saved }
    if (patch.baseUrl !== undefined) next.baseUrl = patch.baseUrl ? normaliseBaseUrl(patch.baseUrl) : ''
    if (patch.modelFast !== undefined) next.modelFast = patch.modelFast
    if (patch.modelStrong !== undefined) next.modelStrong = patch.modelStrong
    for (const which of ['apiKey', 'deepgramKey'] as const) {
      const value = patch[which]
      if (value === undefined) continue
      // An empty string means "forget mine", which falls back to .env.
      next[which] = value === '' ? '' : this.seal(value.trim())
    }
    this.prefs.settings = next
  }

  private seal(key: string): string {
    if (!this.keychain.available) return key
    return `enc:${this.keychain.seal(key)}`
  }

  /** Wipes everything this window can set, leaving .env untouched. */
  forget(): void {
    this.prefs.settings = {}
  }
}

/** The real thing: the OS keychain, by way of Electron. */
export function osKeychain(safeStorage: {
  isEncryptionAvailable(): boolean
  encryptString(value: string): Buffer
  decryptString(value: Buffer): string
}): Keychain {
  return {
    get available() {
      return safeStorage.isEncryptionAvailable()
    },
    seal: (value) => safeStorage.encryptString(value).toString('base64'),
    open: (sealed) => safeStorage.decryptString(Buffer.from(sealed, 'base64'))
  }
}

export async function testConnection(
  config: LlmConfig,
  probe: (config: LlmConfig) => Promise<void>
): Promise<ConnectionResult> {
  const started = Date.now()
  if (!config.baseUrl) return { ok: false, detail: 'No address set.', ms: 0 }
  if (!config.apiKey && !isLocal(config.baseUrl)) {
    return { ok: false, detail: 'That address is not on this machine, so it wants a key.', ms: 0 }
  }
  try {
    await probe(config)
    return { ok: true, detail: 'Answered.', ms: Date.now() - started }
  } catch (error) {
    return { ok: false, detail: reasonFor(error), ms: Date.now() - started }
  }
}

/** Turns the endpoint's own wording into something worth reading. */
function reasonFor(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  if (/model_gated|gated/i.test(message)) return 'That model is gated to your account. Pick another.'
  if (/401|403|unauthor|invalid.*key/i.test(message)) return 'That key was refused.'
  if (/404|not found|does not exist/i.test(message)) return 'No model by that name at that address.'
  if (/timeout|ETIMEDOUT|aborted/i.test(message)) return 'It did not answer in time.'
  if (/ECONNREFUSED|fetch failed|ENOTFOUND/i.test(message)) return 'Nothing answered at that address.'
  return message.slice(0, 200)
}

/**
 * The model list from the endpoint itself, which is the only agnostic way to
 * offer one. Held for the session, because some endpoints list tens of
 * thousands and nobody needs that twice.
 */
export class ModelCatalogue {
  private cache = new Map<string, string[]>()

  async list(config: LlmConfig, query: string, limit = 40): Promise<string[]> {
    const all = await this.fetchOnce(config)
    const needle = query.trim().toLowerCase()
    const matched = needle
      ? all.filter((id) => id.toLowerCase().includes(needle))
      : all
    return matched.slice(0, limit)
  }

  forget(): void {
    this.cache.clear()
  }

  private async fetchOnce(config: LlmConfig): Promise<string[]> {
    const held = this.cache.get(config.baseUrl)
    if (held) return held
    const response = await fetch(`${config.baseUrl}/models`, {
      signal: AbortSignal.timeout(20000),
      headers: config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {}
    })
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`)
    const body = (await response.json()) as { data?: { id?: unknown }[] }
    const ids = (body.data ?? [])
      .map((entry) => (typeof entry.id === 'string' ? entry.id : ''))
      .filter(Boolean)
      .sort()
    this.cache.set(config.baseUrl, ids)
    return ids
  }
}
