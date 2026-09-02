import { screen } from 'electron'
import { DRAG_TICK_INTERVAL_MS } from './constants.js'
import { createClickThrough } from './clickThrough.js'

/**
 * Dragging is driven manually rather than with `-webkit-app-region: drag`, which fights
 * with click-through: the renderer reports press and release, and the window is moved to
 * follow the cursor from here.
 */
const createDrag = ({ win, onDragEnd }) => {
  let timer = null
  let grabOffset = { x: 0, y: 0 }

  const stopDrag = () => {
    if (!timer) return
    clearInterval(timer)
    timer = null
    if (!win.isDestroyed()) onDragEnd?.(win.getPosition())
  }

  const startDrag = () => {
    if (timer || win.isDestroyed()) return
    const cursor = screen.getCursorScreenPoint()
    const [x, y] = win.getPosition()
    grabOffset = { x: cursor.x - x, y: cursor.y - y }

    timer = setInterval(() => {
      if (win.isDestroyed()) return stopDrag()
      const point = screen.getCursorScreenPoint()
      win.setPosition(point.x - grabOffset.x, point.y - grabOffset.y)
    }, DRAG_TICK_INTERVAL_MS)
  }

  return { startDrag, stopDrag, isDragging: () => timer !== null }
}

/** The two window behaviours the renderer steers, presented as one surface. */
export const createInteraction = ({ win, onDragEnd, isLocked }) => ({
  ...createClickThrough({ win, isLocked }),
  ...createDrag({ win, onDragEnd }),
})
