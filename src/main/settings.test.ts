import assert from 'node:assert/strict'
import { test } from 'node:test'
import { SettingsStore, type Keychain, type SettingsHome } from './settings.ts'
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
  LLM_BASE_URL: 'https://env.example/v1',
  MODEL_FAST: 'env/fast',
  MODEL_STRONG: 'env/strong',
  DEEPGRAM_API_KEY: 'env-deepgram-2222'
} as NodeJS.ProcessEnv

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

test('with neither, the checked defaults are used', () => {
  const store = new SettingsStore(home(), vault, {} as NodeJS.ProcessEnv)
  const config = store.llmConfig()
  assert.match(config.fast, /Llama-3\.1-8B/)
  assert.match(config.strong, /Qwen2\.5-14B/)
  assert.equal(config.apiKey, '', 'and no key is invented')
})

test('a key is sealed at rest and never comes back through the window', () => {
  const prefs = home()
  const store = new SettingsStore(prefs, vault, {} as NodeJS.ProcessEnv)
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
  const store = new SettingsStore(prefs, noVault, {} as NodeJS.ProcessEnv)
  store.apply({ apiKey: 'sk-plain-4444' })
  assert.equal(store.apiKey, 'sk-plain-4444')
  assert.equal(store.view().encrypted, false)
})

test('a key sealed by a keychain that is gone reads as absent, not as rubbish', () => {
  const prefs = home()
  new SettingsStore(prefs, vault, {} as NodeJS.ProcessEnv).apply({ apiKey: 'sk-lost-5555' })

  const broken: Keychain = {
    available: true,
    seal: vault.seal,
    open: () => {
      throw new Error('keychain refused')
    }
  }
  const after = new SettingsStore(prefs, broken, {} as NodeJS.ProcessEnv)
  assert.equal(after.apiKey, '')
  assert.equal(after.view().apiKey.set, false)
})

test('an address gets exactly one /v1, however it was typed', () => {
  const store = new SettingsStore(home(), vault, {} as NodeJS.ProcessEnv)
  for (const typed of [
    'http://localhost:11434',
    'http://localhost:11434/',
    'http://localhost:11434/v1',
    'http://localhost:11434/v1/'
  ]) {
    store.apply({ baseUrl: typed })
    assert.equal(store.llmConfig().baseUrl, 'http://localhost:11434/v1', `from ${typed}`)
  }
})

test('a model on this machine is usable with no key at all', () => {
  const store = new SettingsStore(home(), vault, {} as NodeJS.ProcessEnv)
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
