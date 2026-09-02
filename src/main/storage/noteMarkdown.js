/** Pure reading and editing of a day's note file, kept free of Electron so it is testable. */

/*
 * `(?![\s\S])` is end of input. `$` cannot be used here: the `m` flag needed for `^`
 * also makes `$` match end of line, which stopped the lazy body at the first newline and
 * silently truncated every multi-line note.
 */
const ENTRY_PATTERN = /^## (\d{2}:\d{2})\n([\s\S]*?)(?=\n## \d{2}:\d{2}\n|(?![\s\S]))/gm

/** Entries in file order, each with the index that identifies it for editing. */
export const parseEntries = (markdown) =>
  [...String(markdown ?? '').matchAll(ENTRY_PATTERN)]
    .map(([, time, body], index) => ({ index, time, text: body.trim() }))
    .filter((entry) => entry.text !== '')

/**
 * Removes one entry by index and returns the new file contents.
 *
 * Rebuilt from the parsed entries rather than spliced out of the raw text, so a note whose
 * body happens to contain something heading-shaped cannot corrupt the file.
 */
export const removeEntry = (markdown, index) => {
  const text = String(markdown ?? '')
  const firstHeading = text.search(/^## \d{2}:\d{2}$/m)
  const header = firstHeading === -1 ? text : text.slice(0, firstHeading)
  const kept = parseEntries(text).filter((entry) => entry.index !== index)

  const body = kept.map((entry) => `\n## ${entry.time}\n${entry.text}\n`).join('')
  return `${header.trimEnd()}\n${body}`
}
