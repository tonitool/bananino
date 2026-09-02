import { app } from 'electron'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const FILE_NAME = 'clips.json'

export const MAX_CLIPS = 100
export const MAX_CLIP_LENGTH = 20_000

const filePath = () => join(app.getPath('userData'), FILE_NAME)

const isClip = (value) =>
  value !== null &&
  typeof value === 'object' &&
  typeof value.text === 'string' &&
  typeof value.at === 'number'

const sanitize = (clip, index) => ({
  id: typeof clip.id === 'string' ? clip.id : `${clip.at}-${index}`,
  text: clip.text.slice(0, MAX_CLIP_LENGTH),
  at: clip.at,
  pinned: clip.pinned === true,
})

export const readClips = async () => {
  try {
    const parsed = JSON.parse(await readFile(filePath(), 'utf8'))
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isClip).map(sanitize).slice(0, MAX_CLIPS)
  } catch (error) {
    if (error.code !== 'ENOENT') console.warn('[clips] unreadable, starting empty:', error.message)
    return []
  }
}

export const writeClips = async (clips) => {
  try {
    await writeFile(filePath(), JSON.stringify(clips.slice(0, MAX_CLIPS)), 'utf8')
  } catch (error) {
    console.warn('[clips] could not be saved:', error.message)
  }
}

/**
 * Pinned clips are kept regardless of age; unpinned ones are trimmed to the cap. A repeat
 * of an existing clip moves it to the top rather than creating a duplicate.
 */
export const addClip = (clips, { text, at, id }) => {
  const withoutDuplicate = clips.filter((clip) => clip.text !== text)
  const restored = clips.find((clip) => clip.text === text)
  const next = [{ id, text, at, pinned: restored?.pinned ?? false }, ...withoutDuplicate]

  const pinned = next.filter((clip) => clip.pinned)
  const loose = next.filter((clip) => !clip.pinned).slice(0, MAX_CLIPS - pinned.length)
  return next.filter((clip) => pinned.includes(clip) || loose.includes(clip))
}

export const removeClip = (clips, id) => clips.filter((clip) => clip.id !== id)

export const togglePin = (clips, id) =>
  clips.map((clip) => (clip.id === id ? { ...clip, pinned: !clip.pinned } : clip))

export const clearUnpinned = (clips) => clips.filter((clip) => clip.pinned)
