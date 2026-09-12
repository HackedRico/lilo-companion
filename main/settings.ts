import type { ConnectionResult, SettingsPatch, SettingsView } from '../shared/settings.ts'
import { maskKey } from '../shared/settings.ts'
import { reasonFor } from './llm/provider.ts'
import { isLocal, normaliseBaseUrl, protocolFor, type LlmConfig, type ProviderFactory } from './llm/service.ts'
import type { SavedSettings } from './store.ts'
import type { VoiceConfig } from './voice.ts'

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

type Secret = 'apiKey' | 'voiceKey'

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
 * Sensible default models when an address is configured without explicit model
 * choices. If no address is set, nothing is invented.
 */
export function defaultModelsFor(baseUrl: string): { fast: string; strong: string } {
  if (!baseUrl) return { fast: '', strong: '' }
  try {
    const host = new URL(baseUrl).hostname.toLowerCase()
    if (host.includes('featherless.ai')) {
      return {
        fast: 'Qwen/Qwen2.5-Coder-7B-Instruct',
        strong: 'Qwen/Qwen2.5-Coder-14B-Instruct'
      }
    }
    if (host.includes('anthropic.com')) {
      return {
        fast: 'claude-3-5-haiku-20241022',
        strong: 'claude-3-5-sonnet-20241022'
      }
    }
    if (host.includes('groq.com')) {
      return {
        fast: 'llama-3.1-8b-instant',
        strong: 'llama-3.3-70b-versatile'
      }
    }
    if (host.includes('openrouter.ai')) {
      return {
        fast: 'meta-llama/llama-3.1-8b-instruct',
        strong: 'meta-llama/llama-3.3-70b-instruct'
      }
    }
    if (isLocal(baseUrl)) {
      return {
        fast: 'qwen2.5-coder:7b',
        strong: 'qwen2.5-coder:7b'
      }
    }
  } catch {
    // Address may still be incomplete while typing.
  }
  return {
    fast: 'Qwen/Qwen2.5-Coder-7B-Instruct',
    strong: 'Qwen/Qwen2.5-Coder-14B-Instruct'
  }
}

/**
 * The name each address transcribes under when none is typed. OpenAI's name is
 * also what most local servers accept or ignore, so it is the one for the rest.
 */
export function defaultVoiceModelFor(baseUrl: string): string {
  try {
    if (new URL(baseUrl).hostname.toLowerCase().includes('groq.com')) return 'whisper-large-v3-turbo'
  } catch {
    // Address may still be incomplete while typing.
  }
  return 'whisper-1'
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
    return which === 'apiKey' ? configFromEnv(this.env).apiKey : (this.env['VOICE_API_KEY'] ?? '')
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
    const defaults = defaultModelsFor(baseUrl)
    return {
      protocol: protocolFor(baseUrl),
      baseUrl,
      apiKey: this.apiKey,
      fast: this.saved.modelFast || env.fast || defaults.fast,
      strong: this.saved.modelStrong || env.strong || defaults.strong
    }
  }

  /** A voice address typed here or in .env, shaped the OpenAI way, or nothing. */
  private ownVoiceUrl(): string {
    return normaliseBaseUrl(this.saved.voiceUrl || this.env['VOICE_BASE_URL'] || '')
  }

  /**
   * Where speech goes. Left blank it goes where the model is, where that
   * address speaks the OpenAI API: OpenAI's and Groq's transcribe beside
   * chat, and Anthropic's does not. An address typed here is sent its own key,
   * or the model's only where it is the model's own service, so a whisper
   * server on a spare machine is never handed a secret meant for somebody
   * else. Whether an address wants a key at all is the address's to say.
   */
  voiceConfig(llm: LlmConfig = this.llmConfig()): VoiceConfig {
    const own = this.ownVoiceUrl()
    const baseUrl = own || (llm.protocol === 'openai' ? llm.baseUrl : '')
    const apiKey = !baseUrl
      ? ''
      : !own
        ? llm.apiKey
        : this.resolve('voiceKey').value || (sameHost(own, llm.baseUrl) ? llm.apiKey : '')
    return {
      baseUrl,
      apiKey,
      model: this.saved.voiceModel || this.env['VOICE_MODEL'] || defaultVoiceModelFor(baseUrl)
    }
  }

  view(): SettingsView {
    const config = this.llmConfig()
    const key = this.resolve('apiKey')
    const own = this.ownVoiceUrl()
    const voice = this.voiceConfig(config)
    const voiceKey = this.resolve('voiceKey')
    return {
      protocol: config.protocol,
      baseUrl: config.baseUrl,
      modelFast: config.fast,
      modelStrong: config.strong,
      apiKey: { ...maskKey(key.value), fromEnv: key.fromEnv && key.value.length > 0 },
      encrypted: this.keychain.available,
      local: isLocal(config.baseUrl),
      voiceUrl: own,
      voiceModel: voice.model,
      voiceKey: { ...maskKey(voiceKey.value), fromEnv: voiceKey.fromEnv && voiceKey.value.length > 0 },
      // True only when speech really goes to the model's address, not merely when none was typed.
      voiceShared: own.length === 0 && voice.baseUrl.length > 0,
      voiceLocal: isLocal(voice.baseUrl)
    }
  }

  apply(patch: SettingsPatch): void {
    const next: SavedSettings = { ...this.saved }
    if (patch.baseUrl !== undefined) next.baseUrl = patch.baseUrl.trim()
    if (patch.modelFast !== undefined) next.modelFast = patch.modelFast.trim()
    if (patch.modelStrong !== undefined) next.modelStrong = patch.modelStrong.trim()
    if (patch.voiceUrl !== undefined) next.voiceUrl = patch.voiceUrl.trim()
    if (patch.voiceModel !== undefined) next.voiceModel = patch.voiceModel.trim()
    for (const which of ['apiKey', 'voiceKey'] as const) {
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

/** One service under two addresses, which is the only time a key may follow. */
function sameHost(a: string, b: string): boolean {
  try {
    return new URL(a).host === new URL(b).host
  } catch {
    return false
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
