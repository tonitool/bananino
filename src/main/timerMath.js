/** A timer cannot have been running longer than this, however hard it is nudged. */
export const MAX_TIMER_HOURS = 24

/**
 * Moves a timer's start time to add or remove elapsed minutes.
 *
 * Adding time means starting *earlier*. Clamped at both ends: a start in the future would
 * give a negative duration, and a start days back would push an absurd entry into a
 * billable record.
 */
export const nudgedStart = (startedAt, minutes, now = Date.now()) => {
  if (!Number.isFinite(startedAt) || !Number.isFinite(minutes)) return startedAt

  const shifted = startedAt - minutes * 60_000
  const earliest = now - MAX_TIMER_HOURS * 60 * 60 * 1000
  return Math.min(now, Math.max(earliest, shifted))
}
