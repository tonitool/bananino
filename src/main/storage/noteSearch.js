import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parseEntries } from './noteMarkdown.js'

/**
 * Finding a note written on a day nobody remembers.
 *
 * Today's notes already travel with every question, and `read_notes` opens one named day —
 * but "what did I write about the Schaeffler kickoff" names no day at all, which is how
 * people actually look for a note. So this walks the day files backwards from today and
 * stops at the first handful of hits: the newest matches are the ones being asked about,
 * and a year of Markdown is not worth reading to prove it.
 *
 * Takes a directory rather than the data folder, so it stays free of electron and can be
 * tested against a real folder of files.
 */

const DAY_FILE = /^(\d{4}-\d{2}-\d{2})\.md$/

/** How many day files to open before giving up — a couple of years of working days. */
const MAX_DAYS = 500

export const terms = (query) =>
  String(query ?? '')
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)

/** Every word has to be in there somewhere; order and case are not asked about. */
export const matchesTerms = (text, words) => {
  const haystack = String(text ?? '').toLowerCase()
  return words.length > 0 && words.every((word) => haystack.includes(word))
}

export const searchNotes = async ({ dir, query, limit = 8, maxDays = MAX_DAYS }) => {
  const words = terms(query)
  if (words.length === 0) return []

  const days = (await readdir(dir).catch(() => []))
    .filter((name) => DAY_FILE.test(name))
    .sort()
    .reverse()
    .slice(0, maxDays)

  const found = []
  for (const name of days) {
    const text = await readFile(join(dir, name), 'utf8').catch(() => '')
    // Newest first within the day too, so the list reads back in one direction.
    for (const entry of parseEntries(text).reverse()) {
      if (!matchesTerms(entry.text, words)) continue
      found.push({ date: name.match(DAY_FILE)[1], time: entry.time, text: entry.text })
      if (found.length >= limit) return found
    }
  }
  return found
}
