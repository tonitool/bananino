import { BrowserWindow, app, screen } from 'electron'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { clampToWorkArea } from './windowGeometry.js'

const here = dirname(fileURLToPath(import.meta.url))
const PRELOAD = join(here, '..', 'preload', 'index.cjs')
const PAGE = join(here, '..', '..', 'build', 'rewrite.html')

/** Fixed width, and a height the page asks for once it knows what it is showing. */
export const REWRITE_SIZE = Object.freeze({ width: 420, minHeight: 180, maxHeight: 560 })

/** Kept clear of the cursor, so the popup never opens under the pointer that summoned it. */
const CURSOR_OFFSET = 16

/**
 * The rewrite popup: a small panel that appears by the cursor, over whatever app you were
 * writing in.
 *
 * Its own window rather than a view in the pet's panel, for a reason that is not layout:
 * the panel belongs to a window pinned to a corner and shaped around a 3D character, and
 * this has to appear *where you are working*, in front of another app, and take keyboard
 * focus so you can type an instruction. Those are different windows.
 *
 * Created on demand and destroyed on close. It holds the text you selected while it is
 * open, and the surest way not to hold it afterwards is not to exist.
 */
export const createRewriteWindow = ({ onClosed }) => {
  let win = null
  let ignoreBlurUntil = 0

  const place = (bounds) => {
    const cursor = screen.getCursorScreenPoint()
    const { workArea } = screen.getDisplayNearestPoint(cursor)
    return clampToWorkArea(
      { x: cursor.x + CURSOR_OFFSET, y: cursor.y + CURSOR_OFFSET },
      bounds,
      workArea,
    )
  }

  const open = () => {
    if (win && !win.isDestroyed()) {
      win.showInactive()
      win.focus()
      return win
    }

    const size = { width: REWRITE_SIZE.width, height: REWRITE_SIZE.minHeight }
    const { x, y } = place(size)

    win = new BrowserWindow({
      ...size,
      x,
      y,
      show: false,
      frame: false,
      transparent: true,
      hasShadow: true,
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      // Over a full-screen app too: rewriting an email in full screen is the common case.
      visibleOnAllWorkspaces: true,
      webPreferences: {
        preload: PRELOAD,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
        backgroundThrottling: false,
      },
    })

    win.setAlwaysOnTop(true, 'floating')
    win.on('closed', () => {
      win = null
      onClosed?.()
    })
    /*
     * Clicking away is how every popup on this desktop is dismissed — except during a
     * paste, which *has* to make another app frontmost and so blurs this one. Closing
     * then would take the popup away at the exact moment it has something to say: that
     * it replaced your text, and that it can put it back.
     */
    win.on('blur', () => {
      if (Date.now() < ignoreBlurUntil) return
      close()
    })
    win.loadFile(PAGE)
    win.once('ready-to-show', () => {
      win.show()
      // An accessory app shows no Dock icon, and without this the window can open behind
      // the app it was summoned over — where it can be seen but not typed into.
      app.focus({ steal: true })
      win.focus()
    })
    return win
  }

  /**
   * The page measures itself and asks for the height it needs — three versions of a
   * paragraph is a very different window from "nothing was selected".
   */
  const setHeight = (height) => {
    if (!win || win.isDestroyed()) return
    const wanted = Math.round(Number(height) || 0)
    if (!Number.isFinite(wanted) || wanted <= 0) return

    const clamped = Math.min(Math.max(wanted, REWRITE_SIZE.minHeight), REWRITE_SIZE.maxHeight)
    const { x, y, width } = win.getBounds()
    if (clamped === win.getBounds().height) return

    const { workArea } = screen.getDisplayNearestPoint({ x, y })
    const spot = clampToWorkArea({ x, y }, { width, height: clamped }, workArea)
    win.setBounds({ ...spot, width, height: clamped })
  }

  const close = () => {
    if (win && !win.isDestroyed()) win.close()
  }

  /** Held open across a paste, which necessarily hands focus to another app. */
  const holdOpen = (ms = 2500) => {
    ignoreBlurUntil = Date.now() + ms
  }

  return {
    open,
    close,
    holdOpen,
    setHeight,
    isOpen: () => Boolean(win && !win.isDestroyed()),
    send: (channel, payload) => {
      if (win && !win.isDestroyed()) win.webContents.send(channel, payload)
    },
  }
}
