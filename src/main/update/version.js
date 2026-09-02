/** Parses "v1.2.3" or "1.2.3" into comparable parts, ignoring any suffix. */
const parse = (value) => {
  const match = /^v?(\d+)\.(\d+)\.(\d+)/.exec(String(value ?? '').trim())
  return match ? match.slice(1, 4).map(Number) : null
}

/**
 * True when `candidate` is a later release than `current`. Anything unparseable is
 * treated as "not newer" — a malformed tag must never trigger an update prompt.
 */
export const isNewerVersion = (current, candidate) => {
  const a = parse(current)
  const b = parse(candidate)
  if (!a || !b) return false

  for (let i = 0; i < 3; i += 1) {
    if (b[i] > a[i]) return true
    if (b[i] < a[i]) return false
  }
  return false
}

/** Pulls "owner/repo" out of the repository field, or null if it is still a placeholder. */
export const parseRepository = (url) => {
  const match = /github\.com[:/]([^/]+)\/([^/.]+)/.exec(String(url ?? ''))
  if (!match) return null
  const [, owner, repo] = match
  if (owner === 'OWNER' || repo === 'REPO') return null
  return { owner, repo }
}
