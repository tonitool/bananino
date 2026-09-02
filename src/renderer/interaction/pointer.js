import { clamp, damp } from '../animation/easing.js'

/** How far the cursor travels before the character's gaze is fully deflected. */
const GAZE_RANGE_PX = 420

const CLICK_MAX_DURATION_MS = 280
const CLICK_MAX_DISTANCE_PX = 6
const DOUBLE_CLICK_WINDOW_MS = 320

const VELOCITY_SMOOTHING = 0.000001

/**
 * Turns raw cursor traffic into intent. Hover and gaze come from the main process (the
 * only place that sees the cursor when the window is click-through); presses and clicks
 * come from DOM events, which arrive once hovering has made the window interactive.
 */
export const createPointerController = ({ hitTest, handlers }) => {
  let pressedAt = 0
  let pressPoint = { x: 0, y: 0 }
  let lastClickAt = 0
  let dragging = false
  let lastScreen = null
  let velocity = { x: 0, y: 0 }

  const onCursorMoved = (cursor) => {
    handlers.onGaze(gazeFromCursor(cursor))

    if (dragging) {
      velocity = trackVelocity(cursor, lastScreen, velocity)
      lastScreen = { x: cursor.screenX, y: cursor.screenY }
      handlers.onDragVelocity(velocity)
      return
    }

    lastScreen = { x: cursor.screenX, y: cursor.screenY }
    // Queues the position; the render loop decides and applies the hover state.
    hitTest(cursor)
  }

  const onPointerDown = (event) => {
    if (event.button !== 0) return
    pressedAt = performance.now()
    pressPoint = { x: event.screenX, y: event.screenY }
    dragging = true
    velocity = { x: 0, y: 0 }
    handlers.onGrab()
  }

  const onPointerUp = (event) => {
    if (!dragging) return
    dragging = false
    velocity = { x: 0, y: 0 }

    const heldMs = performance.now() - pressedAt
    const travelled = Math.hypot(event.screenX - pressPoint.x, event.screenY - pressPoint.y)
    const wasClick = heldMs < CLICK_MAX_DURATION_MS && travelled < CLICK_MAX_DISTANCE_PX
    const isSecondClick = performance.now() - lastClickAt < DOUBLE_CLICK_WINDOW_MS

    handlers.onRelease({ wasClick, isSecondClick })
    if (wasClick) lastClickAt = performance.now()
  }

  const onContextMenu = (event) => {
    event.preventDefault()
    handlers.onMenu()
  }

  return { onCursorMoved, onPointerDown, onPointerUp, onContextMenu }
}

const gazeFromCursor = ({ x, y, width, height }) => ({
  x: clamp((x - width / 2) / GAZE_RANGE_PX, -1, 1),
  y: clamp((y - height / 2) / GAZE_RANGE_PX, -1, 1),
})

const trackVelocity = (cursor, lastScreen, previous) => {
  if (!lastScreen) return previous
  const instant = { x: cursor.screenX - lastScreen.x, y: cursor.screenY - lastScreen.y }
  // Smoothed hard: raw per-sample deltas are far too jittery to drive a pendulum.
  return {
    x: damp(previous.x, instant.x, VELOCITY_SMOOTHING, 0.033),
    y: damp(previous.y, instant.y, VELOCITY_SMOOTHING, 0.033),
  }
}
