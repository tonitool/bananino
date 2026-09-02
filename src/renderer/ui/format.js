const pad = (n) => String(n).padStart(2, '0')

export const formatElapsed = (ms) => {
  const seconds = Math.max(0, Math.floor(ms / 1000))
  const hours = Math.floor(seconds / 3600)
  const rest = [pad(Math.floor((seconds % 3600) / 60)), pad(seconds % 60)]
  return hours > 0 ? [pad(hours), ...rest].join(':') : rest.join(':')
}

export const formatMinutes = (minutes) => {
  const total = Math.max(0, Math.round(minutes))
  const hours = Math.floor(total / 60)
  return hours > 0 ? `${hours}h ${total % 60}m` : `${total}m`
}

const RELATIVE_STEPS = [
  [60_000, 'just now'],
  [3_600_000, (ms) => `${Math.floor(ms / 60_000)}m ago`],
  [86_400_000, (ms) => `${Math.floor(ms / 3_600_000)}h ago`],
]

export const formatRelative = (timestamp, now = Date.now()) => {
  const age = Math.max(0, now - timestamp)
  for (const [limit, label] of RELATIVE_STEPS) {
    if (age < limit) return typeof label === 'function' ? label(age) : label
  }
  return `${Math.floor(age / 86_400_000)}d ago`
}

/** Clip previews are single-line in the list; newlines become visible middots. */
export const oneLine = (text) => text.replace(/\s+/g, ' ').trim()
