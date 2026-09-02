import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { PLAYERS, parseRunning, parseTrack, runningScript, trackScript } from './players.js'
import { fetchArtwork } from './artwork.js'

const run = promisify(execFile)

/*
 * A pause should register quickly, but each poll spawns osascript (~200ms of work), so
 * this is a compromise: about 5% duty rather than a lag you notice.
 */
const POLL_INTERVAL_MS = 4000
const SCRIPT_TIMEOUT_MS = 5000

/** macOS's error when Automation permission has not been granted for an app. */
const NOT_AUTHORISED = /-1743|Not authorized/i

/** osascript takes one `-e` per line, which keeps the script off the filesystem. */
const osascript = async (script) => {
  const args = script
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => ['-e', line])

  const { stdout } = await run('osascript', args, { timeout: SCRIPT_TIMEOUT_MS })
  return stdout
}

/**
 * Polls Spotify and Apple Music for what is playing.
 *
 * Asks which players are running before querying one, because `tell application` would
 * otherwise launch a closed player — nobody wants a note-taking app opening iTunes.
 */
export const createNowPlaying = ({ isEnabled, onChange, onBlocked }) => {
  let current = null
  let timer = null
  let blocked = false

  const publish = async (track) => {
    const changed =
      track?.title !== current?.title ||
      track?.artist !== current?.artist ||
      track?.player !== current?.player

    if (!changed) return
    current = track
    onChange?.(track)

    // Fetched only when the track changes: a cover is a megabyte of PNG and the script
    // that extracts it is far slower than asking for the title.
    if (!track) return
    const artwork = await fetchArtwork({ playerId: track.player, osascript }).catch(() => null)
    if (current !== track) return
    current = { ...track, artwork }
    onChange?.(current)
  }

  const poll = async () => {
    if (!isEnabled() || blocked) return publish(null)

    const running = parseRunning(await osascript(`return ${runningScript()}`))
    for (const id of running) {
      const player = PLAYERS.find((entry) => entry.id === id)
      const track = parseTrack(id, await osascript(trackScript(player)))
      if (track) return publish(track)
    }
    await publish(null)
  }

  const tick = () =>
    poll().catch((error) => {
      const message = `${error.stderr ?? ''}${error.message ?? ''}`
      if (NOT_AUTHORISED.test(message)) {
        // Asking again every few seconds would achieve nothing but noise.
        blocked = true
        onBlocked?.()
      } else {
        console.warn('[music] could not read what is playing:', error.message)
      }
      void publish(null)
    })

  return {
    start: () => {
      tick()
      timer = setInterval(tick, POLL_INTERVAL_MS)
    },
    stop: () => timer && clearInterval(timer),
    current: () => current,
    /** Re-enabling from the menu should try again even after a refusal. */
    reset: () => ((blocked = false), tick()),
  }
}
