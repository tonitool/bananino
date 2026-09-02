/**
 * The two players worth supporting, and the AppleScript to ask each one what it is doing.
 *
 * Scripts are built per player and never mention a player we are not about to query.
 * AppleScript resolves an application's dictionary at *compile* time, so a single script
 * naming both fails outright on a Mac where either one is not installed.
 */
export const PLAYERS = Object.freeze([
  // Spotify reports track length in milliseconds; Music reports seconds.
  { id: 'spotify', app: 'Spotify', label: 'Spotify', durationDivisor: 1000 },
  { id: 'music', app: 'Music', label: 'Apple Music', durationDivisor: 1 },
])

/** Asks only which players are running — no dictionaries, so it is cheap and always safe. */
export const runningScript = () =>
  PLAYERS.map(({ app }) => `((application "${app}" is running) as text)`).join(' & "," & ')

export const parseRunning = (output) => {
  const flags = String(output ?? '').trim().split(',')
  return PLAYERS.filter((_, index) => flags[index]?.trim() === 'true').map(({ id }) => id)
}

/**
 * One statement per line, with no `¬` continuations: the script is handed to osascript as
 * a series of `-e` arguments, and a continuation cannot span two of them.
 */
export const trackScript = ({ app, durationDivisor }) =>
  [
    `tell application "${app}"`,
    'if player state is playing then',
    'return (name of current track) & tab & (artist of current track) & tab & ' +
      `((player position) as integer) & tab & (((duration of current track) / ${durationDivisor}) as integer)`,
    'end if',
    'end tell',
    'return ""',
  ].join('\n')

/**
 * Asks a player for the current track's cover.
 *
 * Apple Music hands over raw image data, which has to go via a file — AppleScript cannot
 * return binary through stdout. Spotify exposes a plain URL instead.
 */
export const artworkScript = ({ app, id }, destination) => {
  if (id === 'spotify') {
    return [`tell application "${app}"`, 'return artwork url of current track', 'end tell'].join('\n')
  }

  return [
    `tell application "${app}"`,
    'try',
    'set t to current track',
    'on error',
    'return ""',
    'end try',
    'if (count of artworks of t) is 0 then return ""',
    'set d to raw data of artwork 1 of t',
    'end tell',
    `set target to (POSIX file "${destination}")`,
    'set fh to open for access target with write permission',
    'set eof fh to 0',
    'write d to fh',
    'close access fh',
    'return "file"',
  ].join('\n')
}

/** Parses one player's reply, refusing anything that is not a complete, sane answer. */
export const parseTrack = (playerId, output) => {
  const parts = String(output ?? '').trim().split('\t')
  if (parts.length < 4) return null

  const [title, artist, position, duration] = parts
  if (!title.trim()) return null

  const player = PLAYERS.find(({ id }) => id === playerId)
  return {
    player: playerId,
    playerLabel: player?.label ?? playerId,
    title: title.trim(),
    artist: artist.trim(),
    position: Number.isFinite(Number(position)) ? Math.max(0, Number(position)) : 0,
    duration: Number.isFinite(Number(duration)) ? Math.max(0, Number(duration)) : 0,
  }
}
