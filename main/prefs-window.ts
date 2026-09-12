import { BrowserWindow, app } from 'electron'
import { join } from 'node:path'

/**
 * Preferences are a real window, not a pane of the panel. The companion is one
 * conversation and stays that way; typing an API key into it would be absurd.
 */
export class PrefsWindow {
  private win: BrowserWindow | null = null
  private readonly onOpen: (contents: Electron.WebContents) => void

  constructor(onOpen: (contents: Electron.WebContents) => void) {
    this.onOpen = onOpen
  }

  open(): void {
    if (this.win && !this.win.isDestroyed()) {
      this.bringForward(this.win)
      return
    }

    const win = new BrowserWindow({
      width: 780,
      height: 640,
      minWidth: 620,
      minHeight: 460,
      show: false,
      title: 'Lilo',
      titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false
      }
    })

    win.once('ready-to-show', () => this.bringForward(win))
    win.on('closed', () => {
      this.win = null
    })
    this.onOpen(win.webContents)

    const devUrl = process.env['ELECTRON_RENDERER_URL']
    void (devUrl
      ? win.loadURL(`${devUrl}/settings.html`)
      : win.loadFile(join(__dirname, '../renderer/settings.html')))

    this.win = win
  }

  /** The Dock is hidden, so the app has to be told to come forward itself. */
  private bringForward(win: BrowserWindow): void {
    // The Dock is hidden, so macOS has to be told to bring the app forward. On
    // Windows app.focus() would raise the orb window instead; show and focus do.
    if (process.platform === 'darwin') app.focus({ steal: true })
    win.show()
    win.focus()
  }

  close(): void {
    this.win?.close()
  }
}
