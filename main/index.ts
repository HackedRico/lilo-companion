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
import { Llm } from './llm/provider.ts'
import { Panel } from './panel.ts'
import { PrefsWindow } from './prefs-window.ts'
import { asPoint, asSize, asText } from './guards.ts'
import { ModelCatalogue, SettingsStore, osKeychain, testConnection } from './settings.ts'
import { Prefs } from './store.ts'
import { Replay } from './replay.ts'
import { Session } from './session.ts'
import { Listener } from './audio/deepgram.ts'
import { installTray } from './tray.ts'

if (!app.requestSingleInstanceLock()) app.quit()

/** How often the background pass over the transcript is considered. */
const TICK = 15000

function replayArgument(): string | null {
  const flag = process.argv.indexOf('--replay')
  const given = flag >= 0 ? process.argv[flag + 1] : process.env['REPLAY_FILE']
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
  const catalogue = new ModelCatalogue()
  const llm = new Llm(settings.llmConfig())
  const ikb = await loadIkb(dataDir)
  const panel = new Panel(prefs.orb, prefs.panel)
  const prefsWindow = new PrefsWindow((contents) => {
    bridgeEditingShortcuts(contents)
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

  const listener = new Listener(
    settings.deepgramKey,
    (text) => session.heard(text),
    (reason) => {
      setListening(false)
      void session.trouble(`The microphone stopped: ${reason}`)
    }
  )

  // The renderer holds the microphone; the key never leaves this process.
  electronSession.defaultSession.setPermissionRequestHandler((_contents, permission, decide) => {
    decide(permission === 'media')
  })

  /** One way in and out of listening, whether it is a lecture file or a mic. */
  function setListening(on: boolean, fromReplay = false): void {
    if (!on) {
      replay.stop()
      listener.stop()
      panel.emit(OUT.capture, false)
      session.setListening(false)
      tray.refresh()
      return
    }
    if (!fromReplay) {
      if (!listener.available) {
        void session.trouble('There is no Deepgram key set, so I cannot hear a room. Play a lecture instead.')
        return
      }
      void listener.start()
      panel.emit(OUT.capture, true)
    }
    session.setListening(true)
    tray.refresh()
  }

  const replay = new Replay(
    (line) => session.heard(line),
    () => setListening(false)
  )

  /** Reads a saved lecture back in as if it were being spoken. */
  function playLecture(path: string): void {
    void replay
      .load(path)
      .then(() => {
        replay.start()
        setListening(true, true)
      })
      .catch(() => void session.trouble(`I could not read ${path}.`))
  }

  /** Any transcript on disk will do, so the file is chosen rather than shipped. */
  async function pickLecture(): Promise<void> {
    const picked = await dialog.showOpenDialog({
      title: 'Play a saved lecture',
      message: 'A transcript, one line per thing said.',
      filters: [{ name: 'Transcript', extensions: ['txt', 'md', 'vtt'] }],
      properties: ['openFile']
    })
    const path = picked.filePaths[0]
    if (path) playLecture(path)
  }

  const tray = installTray({
    panel,
    openPrefs: () => prefsWindow.open(),
    prefsPath: prefs.path,
    listening: () => session.state.listening,
    setListening: (on) => setListening(on),
    playLecture: () => void pickLecture(),
    endSession: () => {
      setListening(false)
      session.endSession()
    }
  })

  bridgeEditingShortcuts(panel.win.webContents)
  globalShortcut.register('CommandOrControl+Shift+Y', () => {
    panel.toggle()
    tray.refresh()
  })

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
    const file = replayArgument()
    if (file) playLecture(file)
  })

  ipcMain.on(IN.listenStart, () => setListening(true))
  ipcMain.on(IN.listenStop, () => setListening(false))
  ipcMain.on(IN.audioChunk, (_event, chunk: Uint8Array) => listener.send(chunk))
  ipcMain.on(IN.audioError, (_event, reason: string) => {
    setListening(false)
    void session.trouble(`I could not get at the microphone. ${String(reason).slice(0, 120)}`)
  })
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
    listener.setKey(settings.deepgramKey)
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
      const probe = new Llm(config)
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

  const tick = setInterval(() => {
    if (session.dueForExtract()) void session.refresh()
  }, TICK)

  app.on('before-quit', () => {
    clearInterval(tick)
    replay.stop()
    listener.stop()
    globalShortcut.unregisterAll()
  })

  /**
   * macOS delivers copy and paste through the application menu, and this app
   * has none. Claim them here so the composer behaves like a text field.
   */
  function bridgeEditingShortcuts(contents: Electron.WebContents): void {
    contents.on('before-input-event', (event, input) => {
      if (input.type !== 'keyDown' || input.alt) return
      if (!(process.platform === 'darwin' ? input.meta : input.control)) return
      const action: (() => void) | undefined = {
        c: () => contents.copy(),
        v: () => contents.paste(),
        x: () => contents.cut(),
        a: () => contents.selectAll(),
        z: () => (input.shift ? contents.redo() : contents.undo())
      }[input.key.toLowerCase()]
      if (!action) return
      event.preventDefault()
      action()
    })
  }
})

// A menu bar app outlives its window.
app.on('window-all-closed', () => {})
