import { BrowserWindow, app } from 'electron'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { APP_NAME } from './constants.js'

const here = dirname(fileURLToPath(import.meta.url))
const PRELOAD = join(here, '..', 'preload', 'index.cjs')
const PAGE = join(here, '..', '..', 'build', 'settings.html')

/* The buddy's palette, warmest at the top, so the window never flashes white on open. */
const WINDOW_BACKGROUND = '#fbf7ec'

/**
 * Settings as an ordinary Mac window, not a view inside the pet's panel: choosing a
 * costume is a sit-down decision, and a real window gets the traffic lights, the menu
 * shortcut (⌘,) and the room that a 348px panel never had.
 *
 * One window, opened on demand and destroyed on close rather than hidden: it is used
 * once in a blue moon, and keeping it alive would keep its renderer resident for nothing.
 */
export const createSettingsWindow = () => {
  let win = null

  const open = () => {
    if (win && !win.isDestroyed()) {
      win.show()
      win.focus()
      return win
    }

    win = new BrowserWindow({
      width: 720,
      height: 540,
      minWidth: 620,
      minHeight: 440,
      title: `${APP_NAME} Settings`,
      // Traffic lights float over the sidebar, the way System Settings draws them.
      titleBarStyle: 'hiddenInset',
      show: false,
      resizable: true,
      fullscreenable: false,
      backgroundColor: WINDOW_BACKGROUND,
      webPreferences: {
        preload: PRELOAD,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
        // An occluded-but-visible settings window still has to repaint — a switch flipped
        // behind another window must not look unflipped. Same reason the pet gets this.
        backgroundThrottling: false,
      },
    })

    win.on('closed', () => (win = null))
    win.once('ready-to-show', () => {
      win.show()
      // An accessory app shows no Dock icon; without this the window can open behind
      // whatever had focus before.
      app.focus({ steal: true })
      win.focus()
    })
    win.loadFile(PAGE)
    return win
  }

  return {
    open,
    /** No-ops once the window is gone, so broadcasts never have to check first. */
    send: (channel, payload) => {
      if (win && !win.isDestroyed()) win.webContents.send(channel, payload)
    },
  }
}
