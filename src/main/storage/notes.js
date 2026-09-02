import { appendFile, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { clockTime, isoDate, longDate } from './dates.js'
import { ensureDir, notesDir } from './paths.js'
import { parseEntries, removeEntry } from './noteMarkdown.js'

export const MAX_NOTE_LENGTH = 20_000

const noteFile = (dataDir, date) => join(notesDir(dataDir), `${isoDate(date)}.md`)

/**
 * Notes accumulate in one Markdown file per day, newest at the bottom, each stamped with
 * a local clock time. Plain enough to grep, open in any editor, or sync anywhere.
 */
export const appendNote = async ({ dataDir, text, at = new Date() }) => {
  const body = text.trim()
  if (!body) throw new Error('A note cannot be empty.')
  if (body.length > MAX_NOTE_LENGTH) {
    throw new Error(`A note cannot be longer than ${MAX_NOTE_LENGTH} characters.`)
  }

  const dir = await ensureDir(notesDir(dataDir))
  const file = join(dir, `${isoDate(at)}.md`)
  const header = `# ${longDate(at)}\n`

  const existing = await readFile(file, 'utf8').catch((error) => {
    if (error.code === 'ENOENT') return null
    throw error
  })

  if (existing === null) await writeFile(file, header, 'utf8')
  await appendFile(file, `\n## ${clockTime(at)}\n${body}\n`, 'utf8')

  return { file }
}

export const countNotesToday = async ({ dataDir, at = new Date() }) => {
  const text = await readFile(noteFile(dataDir, at), 'utf8').catch(() => '')
  return (text.match(/^## \d{2}:\d{2}$/gm) ?? []).length
}

export const readNotesToday = async ({ dataDir, at = new Date(), limit = 20 }) => {
  const text = await readFile(noteFile(dataDir, at), 'utf8').catch(() => '')
  return parseEntries(text).reverse().slice(0, limit)
}

/** Deleting a note rewrites the day's file; there is no undo, so the caller confirms. */
export const deleteNote = async ({ dataDir, at = new Date(), index }) => {
  const file = noteFile(dataDir, at)
  const text = await readFile(file, 'utf8').catch(() => null)
  if (text === null) return false

  const next = removeEntry(text, index)
  if (next === text) return false
  await writeFile(file, next, 'utf8')
  return true
}

export const readDayMarkdown = ({ dataDir, at = new Date() }) =>
  readFile(noteFile(dataDir, at), 'utf8').catch(() => '')

export const readEntry = async ({ dataDir, at = new Date(), index }) => {
  const entries = parseEntries(await readDayMarkdown({ dataDir, at }))
  return entries.find((entry) => entry.index === index) ?? null
}
