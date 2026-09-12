/**
 * The wire protocol an endpoint speaks. Never a vendor: a vendor is an address
 * typed into the field, and the protocol is what a provider is chosen by.
 */
export type Protocol = 'openai' | 'anthropic'

export interface ProtocolInfo {
  id: Protocol
  label: string
  note: string
  /** A shape for the address field to show, not a value it fills in. */
  placeholder: string
}

export const PROTOCOLS: ProtocolInfo[] = [
  {
    id: 'openai',
    label: 'OpenAI chat completions',
    note: 'What most services and every local server speak. The address ends in /v1.',
    placeholder: 'https://host/v1'
  },
  {
    id: 'anthropic',
    label: 'Anthropic messages',
    note: 'Claude, spoken to directly.',
    placeholder: 'https://api.anthropic.com'
  }
]

export function isProtocol(value: unknown): value is Protocol {
  return PROTOCOLS.some((one) => one.id === value)
}

/** What the student can choose. Keys never live in here. */
export interface Settings {
  protocol: Protocol
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
  apiKey: KeyState
  deepgramKey: KeyState
  /** False when the platform has no keychain, so keys sit in plain text. */
  encrypted: boolean
  /** True when the address is on this machine, so no key is wanted. */
  local: boolean
}

/** An absent field is left alone. An empty string for a key clears it. */
export interface SettingsPatch extends Partial<Settings> {
  apiKey?: string
  deepgramKey?: string
}

export interface ConnectionResult {
  ok: boolean
  detail: string
  ms: number
}

export function maskKey(key: string): KeyState {
  return { set: key.length > 0, hint: key.length > 4 ? `…${key.slice(-4)}` : '', fromEnv: false }
}
