const pad = (n) => String(n).padStart(2, '0')

/** Local-time ISO date. `toISOString` would roll over at the wrong hour for most users. */
export const isoDate = (date) =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`

export const isoMonth = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}`

export const clockTime = (date) => `${pad(date.getHours())}:${pad(date.getMinutes())}`

export const longDate = (date) =>
  date.toLocaleDateString(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })

/** "1h 24m", "24m", "0m" — short enough for a chip, unambiguous enough for a log. */
export const formatMinutes = (minutes) => {
  const total = Math.max(0, Math.round(minutes))
  const hours = Math.floor(total / 60)
  return hours > 0 ? `${hours}h ${total % 60}m` : `${total}m`
}

/** Like formatMinutes, but never rounds a real recording down to "0m". */
export const formatDuration = (ms) => {
  const seconds = Math.max(0, Math.round(ms / 1000))
  return seconds < 60 ? `${seconds}s` : formatMinutes(seconds / 60)
}

export const formatElapsed = (ms) => {
  const seconds = Math.max(0, Math.floor(ms / 1000))
  const hours = Math.floor(seconds / 3600)
  const parts = [pad(Math.floor((seconds % 3600) / 60)), pad(seconds % 60)]
  return hours > 0 ? [pad(hours), ...parts].join(':') : parts.join(':')
}
