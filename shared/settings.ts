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
  apiKey: KeyState
  deepgramKey: KeyState
  /** False when the platform has no keychain, so keys sit in plain text. */
  encrypted: boolean
  /** True when the address is on this machine, so no key is wanted. */
  local: boolean
  defaults: Settings
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

/**
 * Somewhere that speaks the OpenAI chat API. These are shortcuts for filling in
 * an address, not modes: anything else that speaks it works by typing the URL.
 */
export interface Preset {
  id: string
  label: string
  baseUrl: string
  note: string
  /** Only where the models have actually been checked against the endpoint. */
  models?: { fast: string; strong: string }
}

export const PRESETS: Preset[] = [
  {
    id: 'featherless',
    label: 'Featherless',
    baseUrl: 'https://api.featherless.ai/v1',
    note: 'Open models in the cloud, one subscription.',
    models: {
      fast: 'NousResearch/Meta-Llama-3.1-8B-Instruct',
      strong: 'Qwen/Qwen2.5-14B-Instruct'
    }
  },
  {
    id: 'ollama',
    label: 'Ollama',
    baseUrl: 'http://localhost:11434/v1',
    note: 'On this machine. No key, nothing leaves.'
  },
  {
    id: 'lmstudio',
    label: 'LM Studio',
    baseUrl: 'http://localhost:1234/v1',
    note: 'On this machine. No key, nothing leaves.'
  },
  {
    id: 'openai',
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    note: 'Your own OpenAI account.'
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    note: 'One key, most models.'
  },
  {
    id: 'groq',
    label: 'Groq',
    baseUrl: 'https://api.groq.com/openai/v1',
    note: 'Fast, a short list of models.'
  }
]

/** Models confirmed to work end to end, so the picker can say which. */
export const CHECKED = new Set([
  'NousResearch/Meta-Llama-3.1-8B-Instruct',
  'Qwen/Qwen2.5-7B-Instruct',
  'mistralai/Mistral-7B-Instruct-v0.3',
  'Qwen/Qwen2.5-14B-Instruct',
  'Qwen/Qwen2.5-32B-Instruct',
  'Qwen/Qwen2.5-72B-Instruct'
])

export function presetFor(baseUrl: string): Preset | undefined {
  const tidy = baseUrl.replace(/\/+$/, '')
  return PRESETS.find((preset) => preset.baseUrl.replace(/\/+$/, '') === tidy)
}

export function maskKey(key: string): KeyState {
  return { set: key.length > 0, hint: key.length > 4 ? `…${key.slice(-4)}` : '', fromEnv: false }
}
