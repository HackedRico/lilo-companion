import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Provider } from './llm/provider.ts'
import type { LlmConfig } from './llm/service.ts'
import {
  ModelCatalogue,
  SettingsStore,
  defaultModelsFor,
  testConnection,
  type Keychain,
  type SettingsHome
} from './settings.ts'
import type { SavedSettings } from './store.ts'

/** A keychain that is present and reversible, without being a keychain. */
const vault: Keychain = {
  available: true,
  seal: (value) => Buffer.from(value).toString('base64'),
  open: (sealed) => Buffer.from(sealed, 'base64').toString('utf8')
}

const noVault: Keychain = {
  available: false,
  seal: (value) => value,
  open: (sealed) => sealed
}

function home(settings: SavedSettings = {}): SettingsHome {
  return { settings }
}

const ENV = {
  LLM_API_KEY: 'env-key-1111',
  LLM_BASE_URL: 'https://env.example',
  MODEL_FAST: 'env/fast',
  MODEL_STRONG: 'env/strong'
} as NodeJS.ProcessEnv

const NOTHING = {} as NodeJS.ProcessEnv

test('what the window sets wins over what .env says', () => {
  const store = new SettingsStore(home(), vault, ENV)
  assert.equal(store.llmConfig().fast, 'env/fast')

  store.apply({ modelFast: 'mine/fast' })
  assert.equal(store.llmConfig().fast, 'mine/fast')
  assert.equal(store.llmConfig().strong, 'env/strong', 'a field left alone still falls through')
})

test('an empty setting falls back to .env rather than to nothing', () => {
  const store = new SettingsStore(home({ modelFast: 'mine/fast' }), vault, ENV)
  store.apply({ modelFast: '' })
  assert.equal(store.llmConfig().fast, 'env/fast')
})

test('with neither, nothing is configured and nothing is invented', () => {
  const store = new SettingsStore(home(), vault, NOTHING)
  const config = store.llmConfig()
  assert.deepEqual(config, { protocol: 'openai', baseUrl: '', apiKey: '', fast: '', strong: '' })
})

test('known providers supply default fast and strong models when none are set', () => {
  assert.equal(defaultModelsFor('https://api.featherless.ai/v1').fast, 'Qwen/Qwen2.5-Coder-7B-Instruct')
  assert.equal(defaultModelsFor('https://api.featherless.ai/v1').strong, 'Qwen/Qwen2.5-Coder-14B-Instruct')
  assert.equal(defaultModelsFor('https://api.anthropic.com').fast, 'claude-3-5-haiku-20241022')
  assert.equal(defaultModelsFor('https://api.groq.com/openai/v1').fast, 'llama-3.1-8b-instant')
  assert.equal(defaultModelsFor('https://openrouter.ai/api/v1').fast, 'meta-llama/llama-3.1-8b-instruct')
  assert.equal(defaultModelsFor('http://localhost:11434').fast, 'qwen2.5-coder:7b')

  const store = new SettingsStore(home(), vault, NOTHING)
  store.apply({ baseUrl: 'https://api.featherless.ai' })
  assert.equal(store.llmConfig().fast, 'Qwen/Qwen2.5-Coder-7B-Instruct')
  assert.equal(store.llmConfig().strong, 'Qwen/Qwen2.5-Coder-14B-Instruct')
})

test('the protocol is decided from the address and shown, never chosen', () => {
  const store = new SettingsStore(home(), vault, ENV)
  assert.equal(store.view().protocol, 'openai')
  store.apply({ baseUrl: 'https://api.anthropic.com/v1/' })
  assert.equal(store.llmConfig().protocol, 'anthropic')
  assert.equal(store.llmConfig().baseUrl, 'https://api.anthropic.com', 'shaped the way that SDK wants it')
  store.apply({ baseUrl: 'https://api.featherless.ai' })
  assert.equal(store.llmConfig().protocol, 'openai')
  assert.equal(store.llmConfig().baseUrl, 'https://api.featherless.ai/v1')
})

test('a key is sealed at rest and never comes back through the window', () => {
  const prefs = home()
  const store = new SettingsStore(prefs, vault, NOTHING)
  store.apply({ apiKey: 'sk-secret-value-9999' })

  assert.equal(store.apiKey, 'sk-secret-value-9999', 'main can still read it')
  assert.ok(prefs.settings.apiKey?.startsWith('enc:'), 'it is not sitting in plain text')
  assert.ok(
    !JSON.stringify(prefs.settings).includes('sk-secret-value-9999'),
    'the stored file does not contain the key'
  )

  const view = JSON.stringify(store.view())
  assert.ok(!view.includes('sk-secret-value-9999'), 'and neither does anything the renderer sees')
  assert.equal(store.view().apiKey.set, true)
  assert.equal(store.view().apiKey.hint, '…9999')
})

test('clearing your own key falls back to the one in .env', () => {
  const store = new SettingsStore(home(), vault, ENV)
  store.apply({ apiKey: 'sk-mine-3333' })
  assert.equal(store.apiKey, 'sk-mine-3333')
  assert.equal(store.view().apiKey.fromEnv, false)

  store.apply({ apiKey: '' })
  assert.equal(store.apiKey, 'env-key-1111')
  assert.equal(store.view().apiKey.fromEnv, true, 'and the window says where it came from')
})

test('without a keychain the key still works, and the window says so', () => {
  const prefs = home()
  const store = new SettingsStore(prefs, noVault, NOTHING)
  store.apply({ apiKey: 'sk-plain-4444' })
  assert.equal(store.apiKey, 'sk-plain-4444')
  assert.equal(store.view().encrypted, false)
})

test('a key sealed by a keychain that is gone reads as absent, not as rubbish', () => {
  const prefs = home()
  new SettingsStore(prefs, vault, NOTHING).apply({ apiKey: 'sk-lost-5555' })

  const broken: Keychain = {
    available: true,
    seal: vault.seal,
    open: () => {
      throw new Error('keychain refused')
    }
  }
  const after = new SettingsStore(prefs, broken, NOTHING)
  assert.equal(after.apiKey, '')
  assert.equal(after.view().apiKey.set, false)
})

test('a model on this machine is usable with no key at all', () => {
  const store = new SettingsStore(home(), vault, NOTHING)
  store.apply({ baseUrl: 'http://localhost:11434' })
  assert.equal(store.view().local, true)
  assert.equal(store.view().apiKey.set, false)

  store.apply({ baseUrl: 'https://api.example.com/v1' })
  assert.equal(store.view().local, false, 'and a remote one is not mistaken for it')
})

test('forgetting clears the window settings and leaves .env alone', () => {
  const store = new SettingsStore(home(), vault, ENV)
  store.apply({ apiKey: 'sk-mine-6666', modelFast: 'mine/fast' })
  store.forget()
  assert.equal(store.apiKey, 'env-key-1111')
  assert.equal(store.llmConfig().fast, 'env/fast')
})

const REACHABLE: LlmConfig = {
  protocol: 'openai',
  baseUrl: 'https://host/v1',
  apiKey: 'k',
  fast: 'quick',
  strong: 'careful'
}

test('a test says what is missing before it says what the endpoint said', async () => {
  const never = async (): Promise<void> => {
    throw new Error('should not have been asked')
  }
  assert.match((await testConnection({ ...REACHABLE, baseUrl: '' }, never)).detail, /address/i)
  assert.match((await testConnection({ ...REACHABLE, apiKey: '' }, never)).detail, /key/i)
  assert.match((await testConnection({ ...REACHABLE, fast: '' }, never)).detail, /quick model/i)
  const answered = await testConnection(REACHABLE, async () => undefined)
  assert.equal(answered.ok, true)
})

test('the model list is fetched once per endpoint and filtered by what was typed', async () => {
  let fetched = 0
  const provider: Provider = {
    complete: async () => '',
    stream: async () => '',
    models: async () => {
      fetched += 1
      return ['alpha', 'beta', 'gamma']
    }
  }
  const catalogue = new ModelCatalogue(() => provider)
  assert.deepEqual(await catalogue.list(REACHABLE, ''), ['alpha', 'beta', 'gamma'])
  assert.deepEqual(await catalogue.list(REACHABLE, 'ET'), ['beta'])
  assert.equal(fetched, 1)
  await catalogue.list({ ...REACHABLE, baseUrl: 'https://other/v1' }, '')
  assert.equal(fetched, 2, 'a different address is a different endpoint')
})
