import { Menu, Tray, app, shell } from 'electron'
import type { Panel } from './panel.ts'
import { trayIcon } from './tray-icon.ts'

interface Deps {
  panel: Panel
  openPrefs(): void
  prefsPath: string
  listening(): boolean
  setListening(on: boolean): void
  playLecture(): void
  endSession(): void
}

/**
 * The menu bar item. A frameless always on top window needs somewhere to quit
 * from, and playing a saved lecture needs a way in that does not go through the
 * microphone.
 */
export function installTray(deps: Deps): { refresh(): void } {
  const tray = new Tray(trayIcon())
  tray.setToolTip('Lilo')

  const refresh = (): void => {
    tray.setContextMenu(
      Menu.buildFromTemplate([
        {
          label: deps.listening() ? 'Stop listening' : 'Start listening',
          click: () => {
            deps.setListening(!deps.listening())
            refresh()
          }
        },
        {
          label: 'Play a saved lecture…',
          click: () => {
            deps.playLecture()
            refresh()
          }
        },
        { type: 'separator' },
        {
          label: deps.panel.isExpanded ? 'Close the panel' : 'Open the panel',
          accelerator: 'CommandOrControl+Shift+Y',
          click: () => {
            deps.panel.toggle()
            refresh()
          }
        },
        {
          label: 'Click through empty space',
          type: 'checkbox',
          checked: deps.panel.isPassthrough,
          click: () => {
            deps.panel.setPassthrough(!deps.panel.isPassthrough)
            refresh()
          }
        },
        { type: 'separator' },
        { label: 'Settings…', click: () => deps.openPrefs() },
        { type: 'separator' },
        { label: 'End session and forget the transcript', click: () => deps.endSession() },
        { label: 'Show saved data', click: () => void shell.showItemInFolder(deps.prefsPath) },
        { type: 'separator' },
        { label: 'Quit', accelerator: 'CommandOrControl+Q', click: () => app.quit() }
      ])
    )
  }

  refresh()
  return { refresh }
}
