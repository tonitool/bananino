import { clipboard } from 'electron'
import { randomUUID } from 'node:crypto'
import { CLIPBOARD_POLL_INTERVAL_MS, SECRET_CLIPBOARD_MARKERS } from './constants.js'
import { MAX_CLIP_LENGTH, addClip, readClips, writeClips } from './storage/clips.js'

/**
 * Watches the system clipboard for text.
 *
 * Anything a password manager marks as concealed is skipped outright — a clipboard
 * history that quietly records secrets is worse than no history at all. Text this app
 * puts on the clipboard itself is also ignored, so re-copying an old clip does not
 * shuffle the list under the user's cursor.
 *
 * Every clipboard call is awaited: these return promises on current Electron, and
 * awaiting a plain value is harmless on versions where they do not.
 */
export const createClipboardWatcher = ({ isEnabled, onChange }) => {
  let clips = []
  let lastSeen = null
  let selfWritten = null
  let timer = null

  const readText = async () => {
    const text = await clipboard.readText()
    return typeof text === 'string' ? text : ''
  }

  /**
   * Fails closed: if the pasteboard cannot be inspected, the entry is treated as a
   * secret and dropped. Losing a clip is a nuisance; recording a password is not.
   */
  const isConcealed = async () => {
    try {
      const items = await clipboard.read()
      return items.some((item) => {
        const types = Array.isArray(item?.types) ? item.types : Object.keys(item ?? {})
        return types.some((type) =>
          SECRET_CLIPBOARD_MARKERS.some((marker) => String(type).includes(marker)),
        )
      })
    } catch (error) {
      console.warn('[clipboard] pasteboard not readable, skipping this entry:', error.message)
      return true
    }
  }

  const tick = async () => {
    if (!isEnabled()) return

    const text = await readText()
    if (text === lastSeen) return
    lastSeen = text

    if (text === selfWritten) return
    if (!text.trim() || text.length > MAX_CLIP_LENGTH) return
    if (await isConcealed()) return

    clips = addClip(clips, { id: randomUUID(), text, at: Date.now() })
    await writeClips(clips)
    onChange?.(clips)
  }

  /** Copying a stored clip back out must not be recorded as a brand new clip. */
  const copyToClipboard = async (text) => {
    selfWritten = text
    lastSeen = text
    await clipboard.writeText(text)
  }

  const update = async (next) => {
    clips = next
    await writeClips(clips)
    onChange?.(clips)
  }

  const start = async () => {
    clips = await readClips()
    onChange?.(clips)
    // Seeded so whatever was already on the clipboard at launch is not logged as new.
    lastSeen = await readText()

    timer = setInterval(() => {
      tick().catch((error) => console.error('[clipboard] poll failed:', error))
    }, CLIPBOARD_POLL_INTERVAL_MS)
  }

  const stop = () => {
    if (timer) clearInterval(timer)
    timer = null
  }

  return { start, stop, all: () => clips, copyToClipboard, update }
}
