import { Menu, Tray, app, shell } from 'electron'
import type { Panel } from './panel.ts'
import { trayIcon } from './tray-icon.ts'

interface Deps {
  panel: Panel
  openPrefs(): void
  prefsPath: string
  openLecture(): void
  endSession(): void
}

/**
 * The menu bar item. A frameless always on top window needs somewhere to quit
 * from, and a lecture needs a way in that does not go through the panel.
 */
export function installTray(deps: Deps): { refresh(): void } {
  const tray = new Tray(trayIcon())
  tray.setToolTip('Lilo')
  // Windows pops the context menu on right click only; a left click should get it too.
  if (process.platform !== 'darwin') tray.on('click', () => tray.popUpContextMenu())

  const refresh = (): void => {
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: 'Upload a lecture…', click: () => deps.openLecture() },
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
