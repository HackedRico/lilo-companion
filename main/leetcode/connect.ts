import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises'
import { posix, win32 } from 'node:path'
import { promisify } from 'node:util'

/**
 * The one-time step that lets Chrome reach the app: a native messaging host
 * manifest where Chrome looks for one, and a launcher it can run. Everything
 * here is a path or a file's contents, so it is tested without touching the
 * machine, and the one write that differs by platform is a registry key.
 */

export const HOST_NAME = 'com.lilo.companion'

/** Paths are built for the platform named, not the one this runs on, so a test can see both. */
function joinFor(platform: NodeJS.Platform): (...parts: string[]) => string {
  return platform === 'win32' ? win32.join : posix.join
}

export interface Places {
  platform: NodeJS.Platform
  home: string
  userData: string
  /** The app's own binary, which runs the host as plain Node. */
  execPath: string
  hostScript: string
  socketPath: string
  extensionDir: string
}

/** Chrome derives an unpacked extension's id from the public key in its manifest. */
export function extensionId(publicKeyBase64: string): string {
  const digest = createHash('sha256').update(Buffer.from(publicKeyBase64, 'base64')).digest()
  let id = ''
  for (const byte of digest.subarray(0, 16)) {
    id += String.fromCharCode(97 + (byte >> 4)) + String.fromCharCode(97 + (byte & 15))
  }
  return id
}

/**
 * What Chrome runs. A shell script on macOS and Linux, a batch file on
 * Windows; both run the app's binary as Node on the host script, with the
 * socket path as its one argument.
 */
export function launcher(places: Places): { path: string; content: string } {
  const join = joinFor(places.platform)
  if (places.platform === 'win32') {
    return {
      path: join(places.userData, 'lilo-host.bat'),
      content: `@echo off\r\nset ELECTRON_RUN_AS_NODE=1\r\n"${places.execPath}" "${places.hostScript}" "${places.socketPath}"\r\n`
    }
  }
  return {
    path: join(places.userData, 'lilo-host.sh'),
    content: `#!/bin/sh\nELECTRON_RUN_AS_NODE=1 exec "${places.execPath}" "${places.hostScript}" "${places.socketPath}"\n`
  }
}

/**
 * Where the manifest goes. macOS and Linux have a directory Chrome reads. On
 * Windows the manifest can live anywhere, and a registry key under the
 * current user says where.
 */
export function manifestPlace(places: Places): { manifestPath: string; registryKey: string | null } {
  const join = joinFor(places.platform)
  switch (places.platform) {
    case 'darwin':
      return {
        manifestPath: join(places.home, 'Library', 'Application Support', 'Google', 'Chrome', 'NativeMessagingHosts', `${HOST_NAME}.json`),
        registryKey: null
      }
    case 'win32':
      return {
        manifestPath: join(places.userData, `${HOST_NAME}.json`),
        registryKey: `HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\${HOST_NAME}`
      }
    default:
      return {
        manifestPath: join(places.home, '.config', 'google-chrome', 'NativeMessagingHosts', `${HOST_NAME}.json`),
        registryKey: null
      }
  }
}

export function hostManifest(launcherPath: string, id: string): Record<string, unknown> {
  return {
    name: HOST_NAME,
    description: 'Lilo, the companion on this machine',
    path: launcherPath,
    type: 'stdio',
    allowed_origins: [`chrome-extension://${id}/`]
  }
}

export type Run = (file: string, args: string[]) => Promise<unknown>

/** The disk, behind a seam so the Windows half can be checked from a Mac. */
export interface Io {
  readFile(path: string): Promise<string>
  writeFile(path: string, content: string): Promise<void>
  mkdir(path: string): Promise<void>
  chmod(path: string, mode: number): Promise<void>
}

const run: Run = (file, args) => promisify(execFile)(file, args)

const disk: Io = {
  readFile: (path) => readFile(path, 'utf8'),
  writeFile: (path, content) => writeFile(path, content),
  mkdir: (path) => mkdir(path, { recursive: true }).then(() => undefined),
  chmod: (path, mode) => chmod(path, mode)
}

/** Writes the launcher and the manifest, and on Windows the key that points at it. */
export async function installNativeHost(
  places: Places,
  exec: Run = run,
  io: Io = disk
): Promise<{ manifestPath: string; extensionId: string }> {
  const { dirname } = places.platform === 'win32' ? win32 : posix
  const manifest = JSON.parse(await io.readFile(joinFor(places.platform)(places.extensionDir, 'manifest.json'))) as { key?: string }
  if (!manifest.key) throw new Error('the extension manifest has no key, so its id cannot be known')
  const id = extensionId(manifest.key)

  const script = launcher(places)
  await io.mkdir(dirname(script.path))
  await io.writeFile(script.path, script.content)
  // A batch file needs no mode bit; a shell script Chrome cannot execute is silently ignored.
  if (places.platform !== 'win32') await io.chmod(script.path, 0o755)

  const { manifestPath, registryKey } = manifestPlace(places)
  await io.mkdir(dirname(manifestPath))
  await io.writeFile(manifestPath, `${JSON.stringify(hostManifest(script.path, id), null, 2)}\n`)
  if (registryKey) await exec('reg', ['add', registryKey, '/ve', '/t', 'REG_SZ', '/d', manifestPath, '/f'])

  return { manifestPath, extensionId: id }
}
