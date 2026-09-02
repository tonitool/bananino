import { app, nativeImage } from 'electron'
import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import { PLAYERS, artworkScript } from './players.js'

/** Large enough for a crisp thumbnail on a retina display, small enough to send freely. */
const THUMBNAIL_WIDTH = 96

const HTTPS_ONLY = /^https:\/\//i

/**
 * Fetches the current cover and returns it as a data URL.
 *
 * Resized with Electron's own nativeImage rather than an image library: covers arrive at
 * 800² or larger and it is drawn at about 30 pixels, so sending the original over IPC
 * would waste a megabyte per track change.
 */
export const fetchArtwork = async ({ playerId, osascript }) => {
  const player = PLAYERS.find(({ id }) => id === playerId)
  if (!player) return null

  const destination = join(app.getPath('temp'), 'bananino-artwork.bin')
  const output = (await osascript(artworkScript(player, destination))).trim()
  if (!output) return null

  try {
    const image = HTTPS_ONLY.test(output)
      ? nativeImage.createFromBuffer(
          Buffer.from(await (await fetch(output, { signal: AbortSignal.timeout(6000) })).arrayBuffer()),
        )
      : nativeImage.createFromPath(destination)

    if (image.isEmpty()) return null
    return image.resize({ width: THUMBNAIL_WIDTH, quality: 'good' }).toDataURL()
  } catch (error) {
    console.log('[music] no cover available:', error.message)
    return null
  } finally {
    // The file holds one album cover; there is no reason to leave it lying around.
    if (!HTTPS_ONLY.test(output)) await rm(destination, { force: true }).catch(() => {})
  }
}
