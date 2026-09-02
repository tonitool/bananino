export const TAU = Math.PI * 2

export const clamp = (value, min, max) => Math.min(Math.max(value, min), max)

export const lerp = (from, to, t) => from + (to - from) * t

/** Frame-rate independent smoothing: `smoothing` is the fraction left after one second. */
export const damp = (from, to, smoothing, dt) => lerp(from, to, 1 - Math.pow(smoothing, dt))

export const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3)

export const easeInOutCubic = (t) =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2

export const easeOutBack = (t) => {
  const c1 = 1.70158
  const c3 = c1 + 1
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2)
}
