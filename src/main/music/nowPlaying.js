import { PLAYERS, parseRunning, parseTrack, runningScript, trackScript } from './players.js'
import { NOT_AUTHORISED, osascript } from './osascript.js'
import { fetchArtwork } from './artwork.js'

/*
 * A pause should register quickly, but each poll spawns osascript (~200ms of work), so
 * this is a compromise: about 5% duty rather than a lag you notice.
 */
const POLL_INTERVAL_MS = 4000

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
