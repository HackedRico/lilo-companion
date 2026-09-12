import type { ConnectionResult, SettingsPatch, SettingsView } from '../shared/settings.ts'
import { maskKey } from '../shared/settings.ts'
import { isLocal, normaliseBaseUrl, protocolFor, type LlmConfig, type ProviderFactory } from './llm/service.ts'
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

type Secret = 'apiKey'

/**
 * Reads the address, the key and the two model names from .env. Nothing is
 * invented for a blank: an unset field stays unset, and the window says so
 * rather than pointing at somebody's service by default.
 */
function configFromEnv(env: NodeJS.ProcessEnv): Omit<LlmConfig, 'protocol'> {
  return {
    baseUrl: env['LLM_BASE_URL'] ?? '',
    apiKey: env['LLM_API_KEY'] ?? '',
    fast: env['MODEL_FAST'] ?? '',
    strong: env['MODEL_STRONG'] ?? ''
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
    return which === 'apiKey' ? configFromEnv(this.env).apiKey : ''
  }

  private resolve(which: Secret): { value: string; fromEnv: boolean } {
    const chosen = this.stored(which)
    if (chosen) return { value: chosen, fromEnv: false }
    return { value: this.fromEnv(which), fromEnv: true }
  }

  get apiKey(): string {
    return this.resolve('apiKey').value
  }

  llmConfig(): LlmConfig {
    const env = configFromEnv(this.env)
    const baseUrl = normaliseBaseUrl(this.saved.baseUrl || env.baseUrl)
    return {
      protocol: protocolFor(baseUrl),
      baseUrl,
      apiKey: this.apiKey,
      fast: this.saved.modelFast || env.fast,
      strong: this.saved.modelStrong || env.strong
    }
  }

  view(): SettingsView {
    const config = this.llmConfig()
    const key = this.resolve('apiKey')
    return {
      protocol: config.protocol,
      baseUrl: config.baseUrl,
      modelFast: config.fast,
      modelStrong: config.strong,
      apiKey: { ...maskKey(key.value), fromEnv: key.fromEnv && key.value.length > 0 },
      encrypted: this.keychain.available,
      local: isLocal(config.baseUrl)
    }
  }

  apply(patch: SettingsPatch): void {
    const next: SavedSettings = { ...this.saved }
    if (patch.baseUrl !== undefined) next.baseUrl = patch.baseUrl.trim()
    if (patch.modelFast !== undefined) next.modelFast = patch.modelFast.trim()
    if (patch.modelStrong !== undefined) next.modelStrong = patch.modelStrong.trim()
    for (const which of ['apiKey'] as const) {
      const value = patch[which]
      if (value === undefined) continue
      // An empty string means "forget mine", which falls back to .env.
      next[which] = value === '' ? '' : this.seal(value.trim())
    }
    this.prefs.settings = next
  }

  private seal(key: string): string {
    if (!this.keychain.available) return key
    try {
      return `enc:${this.keychain.seal(key)}`
    } catch {
      // DPAPI can refuse at the moment of sealing with no warning from
      // isEncryptionAvailable. An unsealed key beats a save that drops everything.
      return key
    }
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

/** What is missing is said before the endpoint is asked anything. */
export async function testConnection(
  config: LlmConfig,
  probe: (config: LlmConfig) => Promise<void>
): Promise<ConnectionResult> {
  const started = Date.now()
  if (!config.baseUrl) return { ok: false, detail: 'No address set.', ms: 0 }
  if (!config.apiKey && !isLocal(config.baseUrl)) {
    return { ok: false, detail: 'That address is not on this machine, so it wants a key.', ms: 0 }
  }
  if (!config.fast) return { ok: false, detail: 'No quick model set.', ms: 0 }
  if (!config.strong) return { ok: false, detail: 'No careful model set.', ms: 0 }
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
  private readonly make: ProviderFactory
  private cache = new Map<string, string[]>()

  constructor(make: ProviderFactory) {
    this.make = make
  }

  async list(config: LlmConfig, query: string, limit = 40): Promise<string[]> {
    const all = await this.fetchOnce(config)
    const needle = query.trim().toLowerCase()
    const matched = needle ? all.filter((id) => id.toLowerCase().includes(needle)) : all
    return matched.slice(0, limit)
  }

  forget(): void {
    this.cache.clear()
  }

  private async fetchOnce(config: LlmConfig): Promise<string[]> {
    // The same address speaks differently under each protocol, so both name the entry.
    const key = `${config.protocol} ${config.baseUrl}`
    const held = this.cache.get(key)
    if (held) return held
    const ids = await this.make(config).models()
    this.cache.set(key, ids)
    return ids
  }
}
