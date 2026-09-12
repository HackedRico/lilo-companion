import { config as loadEnv } from 'dotenv'

loadEnv()

import {
  Menu,
  app,
  dialog,
  globalShortcut,
  ipcMain,
  safeStorage,
  session as electronSession,
  shell
} from 'electron'
import { join } from 'node:path'
import { z } from 'zod'
import { ASK, IN, OUT } from '../shared/api.ts'
import type { SettingsPatch } from '../shared/settings.ts'
import type { Intent, Profile } from '../shared/types.ts'
import { loadIkb } from './ikb/load.ts'
import { familiesOf, resolveAims } from './ikb/roles.ts'
import { providerFor } from './llm/providers.ts'
import { ModelService } from './llm/service.ts'
import { Panel } from './panel.ts'
import { PrefsWindow } from './prefs-window.ts'
import { asPoint, asSize, asText } from './guards.ts'
import { ModelCatalogue, SettingsStore, osKeychain, testConnection } from './settings.ts'
import { Prefs } from './store.ts'
import { readLecture } from './lecture.ts'
import { Session } from './session.ts'
import { installTray } from './tray.ts'

if (!app.requestSingleInstanceLock()) app.quit()

/** A lecture to read on launch, so a change can be tried without clicking. */
function lectureArgument(): string | null {
  const flag = process.argv.indexOf('--lecture')
  const given = flag >= 0 ? process.argv[flag + 1] : process.env['LECTURE_FILE']
  return given ?? null
}

app.whenReady().then(async () => {
  // A menu bar item, no Dock tile. Hiding the Dock also makes this an accessory
  // app, which is half of never taking the lecture underneath out of front.
  app.dock?.hide()
  // No application menu, so Escape and Cmd W reach the renderer. Editing
  // shortcuts are bridged below, since macOS routes those through the menu.
  Menu.setApplicationMenu(null)

  const dev = Boolean(process.env['ELECTRON_RENDERER_URL'])
  const dataDir = app.isPackaged
    ? join(process.resourcesPath, 'data')
    : join(app.getAppPath(), 'data')

  const prefs = new Prefs()
  const settings = new SettingsStore(prefs, osKeychain(safeStorage))
  const catalogue = new ModelCatalogue(providerFor)
  const llm = new ModelService(settings.llmConfig(), providerFor)
  const ikb = await loadIkb(dataDir)
  const panel = new Panel(prefs.orb, prefs.panel)
  const prefsWindow = new PrefsWindow((contents) => {
    // The panel closes itself on Cmd+W; the preferences window needs telling.
    bridgeEditingShortcuts(contents, { KeyW: () => prefsWindow.close() })
    if (!dev) return
    contents.on('console-message', (event) => console.log(`[prefs] ${event.message}`))
    contents.on('did-finish-load', () => console.log('[prefs] loaded'))
    contents.on('did-fail-load', (_e, code, description, url) =>
      console.log(`[prefs] failed ${code} ${description} ${url}`)
    )
  })

  const session = new Session({
    llm,
    ikb,
    emit: {
      patch: (patch) => {
        // A whisper needs the window to grow before the renderer can draw it.
        if ('whisper' in patch) panel.setWhisper(Boolean(patch.whisper))
        panel.emit(OUT.patch, patch)
      },
      add: (item) => {
        if (dev) console.log(`[thread] ${item.speaker}: ${item.text || '…'}`)
        panel.emit(OUT.threadAdd, item)
      },
      token: (id, token) => panel.emit(OUT.threadToken, { id, token }),
      end: (id, patch) => panel.emit(OUT.threadEnd, { id, ...patch }),
      card: (card) => panel.emit(OUT.cardNew, card),
      recap: (recap) => panel.emit(OUT.recap, recap)
    },
    loadProfile: () => prefs.profile,
    saveProfile: (profile) => {
      prefs.profile = profile
    }
  })

  panel.onExpandedChange = (expanded) => session.setExpanded(expanded)

  // Nothing in a renderer needs a device or a permission, so every request is refused.
  electronSession.defaultSession.setPermissionRequestHandler((_contents, _permission, decide) => decide(false))

  /** Reads a lecture whole and hands it to the loop. */
  function openLecture(path: string): void {
    void readLecture(path)
      .then((text) => session.useNotes(text))
      .catch(() => void session.trouble(`I could not read ${path}.`))
  }

  /** Any transcript on disk will do, so the file is chosen rather than shipped. */
  async function pickLecture(): Promise<void> {
    const picked = await dialog.showOpenDialog({
      // The hint rides in the title, which every platform shows; message is macOS only.
      title: 'Upload a lecture: a transcript or your notes, one line per thing said',
      filters: [{ name: 'Transcript', extensions: ['txt', 'md', 'vtt'] }],
      properties: ['openFile']
    })
    const path = picked.filePaths[0]
    if (path) openLecture(path)
  }

  const tray = installTray({
    panel,
    openPrefs: () => prefsWindow.open(),
    prefsPath: prefs.path,
    openLecture: () => void pickLecture(),
    endSession: () => session.endSession()
  })

  bridgeEditingShortcuts(panel.win.webContents)
  const toggleKey = 'CommandOrControl+Shift+Y'
  const registered = globalShortcut.register(toggleKey, () => {
    panel.toggle()
    tray.refresh()
  })
  // Another app can already hold the combination, and registration says so quietly.
  if (!registered) console.warn(`[lilo] ${toggleKey} is held by another app; the panel opens from the orb and the menu bar`)

  if (dev) {
    panel.win.webContents.on('console-message', (event) => {
      console.log(`[renderer] ${event.message}`)
    })
    console.log(`[lilo] ${ikb.postingCount} postings, model ${llm.available ? llm.config.fast : 'not configured'}`)
  }

  ipcMain.on(IN.ready, () => {
    panel.emit(OUT.state, session.state)
    panel.emit(OUT.profile, session.getProfile())
    panel.pushLayout()
    if (!session.state.onboarded) {
      panel.setExpanded(true)
      void session.startOnboarding()
    }
    // Lets the preferences window be worked on against the real keychain and
    // the real settings file, without hunting for the menu bar every reload.
    if (dev && process.env['LILO_OPEN_PREFS']) prefsWindow.open()
    const file = lectureArgument()
    if (file) openLecture(file)
  })

  ipcMain.on(IN.lectureOpen, () => void pickLecture())
  ipcMain.on(IN.notes, (_event, text: unknown) => void session.useNotes(asText(text)))
  ipcMain.on(IN.intent, (_event, intent: Intent) => void session.run(intent))
  ipcMain.on(IN.typed, (_event, text: unknown) => void session.typed(asText(text)))
  ipcMain.on(IN.profileGet, () => panel.emit(OUT.profile, session.getProfile()))
  ipcMain.on(IN.profileUpdate, (_event, patch: Partial<Profile>) => {
    session.updateProfile(patch)
    panel.emit(OUT.profile, session.getProfile())
  })
  ipcMain.on(IN.sessionEnd, () => session.endSession())

  ipcMain.on(IN.toggle, () => {
    panel.toggle()
    tray.refresh()
  })
  ipcMain.on(IN.expand, (_event, on: boolean) => {
    panel.setExpanded(Boolean(on))
    tray.refresh()
  })
  ipcMain.on(IN.dismissWhisper, () => session.dismissWhisper())

  ipcMain.on(IN.dragStart, (_event, at: unknown) => {
    const point = asPoint(at)
    if (point) panel.dragStart(point)
  })
  ipcMain.on(IN.dragMove, (_event, at: unknown) => {
    const point = asPoint(at)
    if (point) panel.dragMove(point)
  })
  ipcMain.on(IN.dragEnd, () => {
    prefs.orb = panel.dragEnd()
  })
  ipcMain.on(IN.resize, (_event, size: unknown) => {
    const wanted = asSize(size)
    if (wanted) panel.resize(wanted)
  })
  // Written once the corner is let go, not on every frame of the drag.
  ipcMain.on(IN.resizeEnd, () => {
    prefs.panel = panel.size
  })
  ipcMain.on(IN.clickThrough, (_event, on: boolean) => panel.setClickThrough(Boolean(on)))
  ipcMain.on(IN.openPrefs, () => prefsWindow.open())
  ipcMain.on(IN.closePrefs, () => prefsWindow.close())

  /** Settings can change at any moment, so everything that holds config re-reads it. */
  function adopt(): void {
    llm.reconfigure(settings.llmConfig())
    catalogue.forget()
    tray.refresh()
  }

  ipcMain.handle(ASK.settingsGet, () => settings.view())
  ipcMain.handle(ASK.settingsSet, (_event, patch: SettingsPatch) => {
    settings.apply(patch)
    adopt()
    return settings.view()
  })
  ipcMain.handle(ASK.settingsForget, () => {
    prefs.forgetEverything()
    adopt()
    session.updateProfile(prefs.profile)
    panel.emit(OUT.profile, session.getProfile())
    return settings.view()
  })
  ipcMain.handle(ASK.settingsTest, () =>
    testConnection(settings.llmConfig(), async (config) => {
      const probe = new ModelService(config, providerFor)
      await probe.json(z.object({ ok: z.boolean() }), {
        lane: 'fast',
        maxTokens: 40,
        system: 'Reply with one JSON object and nothing else. Schema: {"ok":boolean}',
        user: 'Say ok.'
      })
    })
  )
  ipcMain.handle(ASK.profileRead, () => session.getProfile())
  ipcMain.handle(ASK.profileWrite, (_event, patch: Partial<Profile>) => {
    // A typed aim only counts for as much as the postings say it does.
    if (patch.aims) {
      patch.targetRoles = familiesOf(resolveAims(ikb, patch.aims))
    }
    session.updateProfile(patch)
    panel.emit(OUT.profile, session.getProfile())
    return session.getProfile()
  })
  ipcMain.handle(ASK.storagePath, () => prefs.path)
  ipcMain.handle(ASK.resolveAims, (_event, said: string[]) =>
    resolveAims(ikb, Array.isArray(said) ? said.map((one) => asText(one, 80)) : [])
  )
  ipcMain.handle(ASK.models, async (_event, query: string) => {
    try {
      return { models: await catalogue.list(settings.llmConfig(), String(query ?? '')), detail: '' }
    } catch (error) {
      // An endpoint with no model list is fine; the name can still be typed.
      return { models: [], detail: (error as Error).message.slice(0, 120) }
    }
  })
  ipcMain.on(IN.openLink, (_event, url: string) => {
    // Postings open in the student's own browser, never inside the panel.
    if (/^https:\/\//.test(String(url))) void shell.openExternal(String(url))
  })

  app.on('before-quit', () => {
    globalShortcut.unregisterAll()
  })

  /**
   * macOS delivers copy and paste through the application menu, and this app
   * has none. Claim them here so the composer behaves like a text field.
   */
  function bridgeEditingShortcuts(contents: Electron.WebContents, extra: Record<string, () => void> = {}): void {
    const mac = process.platform === 'darwin'
    contents.on('before-input-event', (event, input) => {
      if (input.type !== 'keyDown' || input.alt) return
      if (!(mac ? input.meta : input.control)) return
      // Matched on the physical key, so a Cyrillic or Greek layout still copies.
      const action: (() => void) | undefined = {
        KeyC: () => contents.copy(),
        KeyV: () => contents.paste(),
        KeyX: () => contents.cut(),
        KeyA: () => contents.selectAll(),
        KeyZ: () => (input.shift ? contents.redo() : contents.undo()),
        // Windows redoes with Ctrl+Y as well.
        ...(mac ? {} : { KeyY: () => contents.redo() }),
        // With no application menu, Cmd+Q exists only if it is claimed here.
        KeyQ: () => app.quit(),
        ...extra
      }[input.code]
      if (!action) return
      event.preventDefault()
      action()
    })
  }
})

// A menu bar app outlives its window.
app.on('window-all-closed', () => {})
