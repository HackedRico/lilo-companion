/**
 * How an endpoint speaks. Never chosen: the service layer decides it from the
 * address, and the window only shows what was decided.
 */
export type Protocol = 'openai' | 'anthropic'

export const PROTOCOL_LABEL: Record<Protocol, string> = {
  openai: 'OpenAI chat API',
  anthropic: 'Anthropic messages API'
}

/** What the student can choose. Keys never live in here. */
export interface Settings {
  baseUrl: string
  modelFast: string
  modelStrong: string
}

/** A key as the renderer is allowed to see it: whether it is set, and its tail. */
export interface KeyState {
  set: boolean
  hint: string
  /** True when the value came from .env rather than from this window. */
  fromEnv: boolean
}

export interface SettingsView extends Settings {
  /** Decided from the address, so the student can see what will be spoken. */
  protocol: Protocol
  apiKey: KeyState
  /** False when the platform has no keychain, so keys sit in plain text. */
  encrypted: boolean
  /** True when the address is on this machine, so no key is wanted. */
  local: boolean
}

/** An absent field is left alone. An empty string for a key clears it. */
export interface SettingsPatch extends Partial<Settings> {
  apiKey?: string
}

export interface ConnectionResult {
  ok: boolean
  detail: string
  ms: number
}

export function maskKey(key: string): KeyState {
  return { set: key.length > 0, hint: key.length > 4 ? `…${key.slice(-4)}` : '', fromEnv: false }
}
