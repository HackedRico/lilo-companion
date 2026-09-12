import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { HOST_NAME, extensionId, hostManifest, installNativeHost, launcher, manifestPlace, type Places } from './connect.ts'

const places = (platform: NodeJS.Platform): Places => ({
  platform,
  home: platform === 'win32' ? 'C:\\Users\\sam' : '/Users/sam',
  userData: platform === 'win32' ? 'C:\\Users\\sam\\AppData\\Roaming\\Lilo' : '/Users/sam/Library/Application Support/Lilo',
  execPath: platform === 'win32' ? 'C:\\Program Files\\Lilo\\Lilo.exe' : '/Applications/Lilo.app/Contents/MacOS/Lilo',
  hostScript: platform === 'win32' ? 'C:\\Program Files\\Lilo\\resources\\host.js' : '/Applications/Lilo.app/Contents/Resources/host.js',
  socketPath: platform === 'win32' ? '\\\\.\\pipe\\lilo-abc' : '/tmp/lilo-abc.sock',
  extensionDir: resolve(import.meta.dirname, '../../extension')
})

test('the extension id is what chrome derives from the key in its manifest', async () => {
  const manifest = JSON.parse(await readFile(join(places('darwin').extensionDir, 'manifest.json'), 'utf8')) as { key: string }
  assert.equal(extensionId(manifest.key), 'agfnhlfgabpcchlfnhfmhkejcondakef')
  assert.match(extensionId(manifest.key), /^[a-p]{32}$/)
})

test('the launcher runs the app as node on the host script, on either os', () => {
  const mac = launcher(places('darwin'))
  assert.equal(mac.path, '/Users/sam/Library/Application Support/Lilo/lilo-host.sh')
  assert.equal(
    mac.content,
    '#!/bin/sh\nELECTRON_RUN_AS_NODE=1 exec "/Applications/Lilo.app/Contents/MacOS/Lilo" "/Applications/Lilo.app/Contents/Resources/host.js" "/tmp/lilo-abc.sock"\n'
  )
  const win = launcher(places('win32'))
  assert.equal(win.path, 'C:\\Users\\sam\\AppData\\Roaming\\Lilo\\lilo-host.bat')
  assert.match(win.content, /^@echo off\r\nset ELECTRON_RUN_AS_NODE=1\r\n"C:\\Program Files\\Lilo\\Lilo.exe" /)
})

test('the manifest goes where chrome reads it, and windows gets a registry key', () => {
  assert.deepEqual(manifestPlace(places('darwin')), {
    manifestPath: `/Users/sam/Library/Application Support/Google/Chrome/NativeMessagingHosts/${HOST_NAME}.json`,
    registryKey: null
  })
  assert.deepEqual(manifestPlace(places('win32')), {
    manifestPath: `C:\\Users\\sam\\AppData\\Roaming\\Lilo\\${HOST_NAME}.json`,
    registryKey: `HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\${HOST_NAME}`
  })
  assert.equal(manifestPlace(places('linux')).registryKey, null)
})

test('the host manifest allows exactly one extension', () => {
  const manifest = hostManifest('/x/lilo-host.sh', 'abcd')
  assert.equal(manifest['type'], 'stdio')
  assert.deepEqual(manifest['allowed_origins'], ['chrome-extension://abcd/'])
})

test('installing writes the launcher and the manifest, and only windows touches the registry', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'lilo-'))
  const here: Places = { ...places('darwin'), home: dir, userData: join(dir, 'Lilo') }
  const ran: string[][] = []
  const result = await installNativeHost(here, async (file, args) => void ran.push([file, ...args]))
  assert.equal(ran.length, 0)
  const written = JSON.parse(await readFile(result.manifestPath, 'utf8')) as { path: string; allowed_origins: string[] }
  assert.equal(written.path, join(dir, 'Lilo', 'lilo-host.sh'))
  assert.deepEqual(written.allowed_origins, [`chrome-extension://${result.extensionId}/`])
  assert.match(await readFile(written.path, 'utf8'), /^#!\/bin\/sh\n/)

  // Windows, without a Windows disk: what would be written, and the one key that points at it.
  const key = await readFile(join(places('darwin').extensionDir, 'manifest.json'), 'utf8')
  const files = new Map<string, string>()
  const modes: string[] = []
  const win = await installNativeHost(
    places('win32'),
    async (file, args) => void ran.push([file, ...args]),
    {
      readFile: async () => key,
      writeFile: async (path, content) => void files.set(path, content),
      mkdir: async () => undefined,
      chmod: async (path) => void modes.push(path)
    }
  )
  assert.equal(win.manifestPath, `C:\\Users\\sam\\AppData\\Roaming\\Lilo\\${HOST_NAME}.json`)
  assert.ok(files.has('C:\\Users\\sam\\AppData\\Roaming\\Lilo\\lilo-host.bat'))
  assert.equal(modes.length, 0, 'a batch file gets no mode bit')
  assert.deepEqual(ran, [['reg', 'add', `HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\${HOST_NAME}`, '/ve', '/t', 'REG_SZ', '/d', win.manifestPath, '/f']])
})
