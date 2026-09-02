const MAX_MINUTES = 24 * 60

/**
 * Parses the ways people actually write a duration, including the German decimal comma
 * ("1,5h") and a bare number meaning minutes.
 *
 * Returns minutes, or null when the text is not a duration at all — the caller must not
 * guess, because a misread duration becomes a wrong billable record.
 */
export const parseDuration = (input) => {
  const text = String(input ?? '')
    .trim()
    .toLowerCase()
    .replace(',', '.')

  if (!text) return null

  const clamp = (minutes) =>
    Number.isFinite(minutes) && minutes > 0 && minutes <= MAX_MINUTES ? Math.round(minutes) : null

  // 1:30 — hours and minutes
  const colon = text.match(/^(\d{1,2}):(\d{1,2})$/)
  if (colon) {
    const [, hours, minutes] = colon
    return Number(minutes) < 60 ? clamp(Number(hours) * 60 + Number(minutes)) : null
  }

  // 1h30, 1h 30m, 2h, 1.5h
  const hoursAndMinutes = text.match(/^(\d+(?:\.\d+)?)\s*h(?:ours?|rs?)?\s*(\d{1,2})?\s*(?:m|min|mins|minutes?)?$/)
  if (hoursAndMinutes) {
    const [, hours, minutes] = hoursAndMinutes
    if (minutes !== undefined && Number(minutes) >= 60) return null
    return clamp(Number(hours) * 60 + Number(minutes ?? 0))
  }

  // 90m, 90 min, 90 minutes
  const minutesOnly = text.match(/^(\d+(?:\.\d+)?)\s*(?:m|min|mins|minutes?)$/)
  if (minutesOnly) return clamp(Number(minutesOnly[1]))

  // A bare number is minutes, which is what people type when they are in a hurry.
  const bare = text.match(/^(\d+(?:\.\d+)?)$/)
  if (bare) return clamp(Number(bare[1]))

  return null
}

/** "90m" → "1h 30m", for echoing back what was understood before anything is saved. */
export const describeMinutes = (minutes) => {
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  if (hours === 0) return `${rest}m`
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`
}
