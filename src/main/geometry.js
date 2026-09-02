import { CURSOR_EPSILON_PX } from './constants.js'

export const isInside = (point, bounds) =>
  point.x >= bounds.x &&
  point.x < bounds.x + bounds.width &&
  point.y >= bounds.y &&
  point.y < bounds.y + bounds.height

/**
 * True for the first sample as well as for real movement. Comparing against an unset
 * previous point with arithmetic yields NaN, and every NaN comparison is false — which
 * would silently wedge the tracker shut forever.
 */
export const hasMoved = (previous, point) => {
  if (!previous) return true
  return (
    Math.abs(point.x - previous.x) >= CURSOR_EPSILON_PX ||
    Math.abs(point.y - previous.y) >= CURSOR_EPSILON_PX
  )
}
