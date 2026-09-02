import { screen } from 'electron'
import { CURSOR_POLL_INTERVAL_MS, IPC } from './constants.js'
import { hasMoved, isInside } from './geometry.js'

/**
 * The renderer only receives mouse events while the pointer is over the window, so the
 * global cursor is sampled here. It doubles as a safety net: if the pointer leaves the
 * window faster than the renderer can react, click-through is restored from this side.
 *
 * `listeners` are called with every sample, moved or not, so features like the hot corner
 * do not each need their own poll timer.
 */
export const startCursorTracker = ({ win, interaction, listeners = [] }) => {
  let last = null

  const tick = () => {
    if (win.isDestroyed()) return

    const point = screen.getCursorScreenPoint()
    for (const listener of listeners) listener(point)

    if (!win.isVisible()) return
    const bounds = win.getBounds()

    // Restores click-through if the pointer left faster than the renderer could react.
    // Refused while the panel is open — see the lock in interaction.js.
    if (!interaction.isDragging() && interaction.isInteractive() && !isInside(point, bounds)) {
      interaction.setInteractive(false)
    }

    if (!hasMoved(last, point)) return
    last = point

    // Sent in window-local pixels so the renderer never has to know about screen geometry.
    win.webContents.send(IPC.cursorMoved, {
      x: point.x - bounds.x,
      y: point.y - bounds.y,
      screenX: point.x,
      screenY: point.y,
      width: bounds.width,
      height: bounds.height,
    })
  }

  const timer = setInterval(tick, CURSOR_POLL_INTERVAL_MS)
  return () => clearInterval(timer)
}
