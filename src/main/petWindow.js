import { BrowserWindow } from 'electron'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const PRELOAD = join(here, '..', 'preload', 'index.cjs')
const PAGE = join(here, '..', '..', 'build', 'index.html')

export const createPetWindow = () => {
  const win = new BrowserWindow({
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    acceptFirstMouse: true,
    roundedCorners: false,
    webPreferences: {
      preload: PRELOAD,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false,
      spellcheck: true,
    },
  })

  // 'screen-saver' keeps the character above full-screen apps and other floating windows.
  win.setAlwaysOnTop(true, 'screen-saver')
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  // Forwarding keeps mousemove flowing so the renderer can tell when to become clickable.
  win.setIgnoreMouseEvents(true, { forward: true })

  // LUALALA_YAW re-aims a swapped-in model and LUALALA_ZOOM reframes the camera, both
  // without touching the source.
  const query = Object.fromEntries(
    [
      ['yaw', process.env.LUALALA_YAW],
      ['zoom', process.env.LUALALA_ZOOM],
    ].filter(([, value]) => value),
  )
  win.loadFile(PAGE, Object.keys(query).length > 0 ? { query } : undefined)

  return win
}
