export const ROUNDING_STEPS = Object.freeze([0, 5, 15])

/**
 * Rounds a duration up to a billing increment. MOCO can do this server-side too, but only
 * if the account is configured for it — doing it here makes what was sent match what was
 * meant.
 *
 * Always rounds *up*, never down, and is off by default: rounding up bills more time than
 * was worked, so it has to be a deliberate choice rather than a helpful surprise.
 */
export const roundMinutesUp = (minutes, step) => {
  if (!ROUNDING_STEPS.includes(step) || step === 0) return minutes
  if (!Number.isFinite(minutes) || minutes <= 0) return minutes
  return Math.ceil(minutes / step) * step
}
