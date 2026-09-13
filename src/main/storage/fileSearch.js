/**
 * Finding a file the way it gets asked for: "the invoice in my Downloads", "what did I
 * download yesterday", "that spec sketch somewhere on my Mac".
 *
 * Three things people say, and the first version of this only answered the third — a bare
 * `mdfind` over the whole Mac, in whatever order Spotlight's index felt like, with no way
 * to say where to look. Asking for "the PDF in Downloads" then searched every volume for
 * the word *downloads*, which is how you get a hundred hits and none of them the file.
 *
 * So: a folder can be named, and results come back newest-modified first — which is what
 * the tool always claimed and never did. "The one from yesterday" is the most common way
 * a person picks between two files with similar names, and Spotlight's own order is no
 * help with it.
 *
 * Everything here only looks. The exec, the stat and the directory read are handed in, so
 * this is testable off a Mac and cannot reach anything the caller did not give it.
 */

/** Folders worth knowing by the name people say, mapped to what electron calls them. */
export const FOLDER_NAMES = Object.freeze({
  downloads: 'downloads',
  download: 'downloads',
  desktop: 'desktop',
  documents: 'documents',
  docs: 'documents',
  music: 'music',
  pictures: 'pictures',
  photos: 'pictures',
  movies: 'videos',
  videos: 'videos',
  home: 'home',
})

/**
 * A folder as an absolute path, from either a name or a path.
 *
 * "Downloads", "downloads folder", "~/Downloads" and "/Users/me/Downloads" all arrive from
 * a model for the same folder, so all four resolve. Anything else is refused rather than
 * guessed at: searching the wrong folder looks exactly like finding nothing.
 */
export const resolveFolder = (value, { home, known }) => {
  const asked = String(value ?? '').trim()
  if (!asked) return null

  if (asked === '~' || asked.startsWith('~/')) return `${home}${asked.slice(1)}`
  if (asked.startsWith('/')) return asked

  const name = asked.toLowerCase().replace(/\s*folder$/, '').replace(/^(my|the)\s+/, '').trim()
  const wellKnown = FOLDER_NAMES[name]
  return wellKnown ? known(wellKnown) : null
}

/** How many hits are dated before the newest are picked — a stat each, so bounded. */
const CANDIDATES = 60

/** '2026-09-12 14:03  /Users/me/Downloads/invoice.pdf' — the date is how you tell two apart. */
export const formatFile = ({ path, modified }) =>
  modified ? `${modified.toISOString().slice(0, 16).replace('T', ' ')}  ${path}` : path

export const createFileSearch = ({ mdfind, statFile, readFolder, home, known }) => {
  /** Dated and sorted, newest first. Anything that cannot be stat'd has gone: drop it. */
  const newestFirst = async (paths, limit) => {
    const dated = await Promise.all(
      paths.slice(0, CANDIDATES).map(async (path) => {
        const found = await statFile(path).catch(() => null)
        return found ? { path, modified: found.mtime } : null
      }),
    )

    return dated
      .filter(Boolean)
      .sort((a, b) => b.modified - a.modified)
      .slice(0, limit)
  }

  return async ({ query, folder, limit = 10 } = {}) => {
    const words = String(query ?? '').trim()
    const dir = folder ? resolveFolder(folder, { home, known }) : null

    if (folder && !dir) {
      return {
        failed: `I do not know where "${folder}" is. Name a folder like Downloads or Desktop, or give the full path.`,
      }
    }

    // A folder and no words is "what is in there" — a list, newest first, not a search.
    if (dir && !words) {
      const names = await readFolder(dir).catch(() => null)
      if (names === null) return { failed: `There is no folder at ${dir}.` }
      // Dotfiles are the Mac's business, not the user's; .DS_Store is never the answer.
      const visible = names.filter((name) => !name.startsWith('.')).map((name) => `${dir}/${name}`)
      return { dir, files: await newestFirst(visible, limit) }
    }

    if (!words) return { failed: 'No search words were given.' }

    const paths = await mdfind(dir ? ['-onlyin', dir, words] : [words]).catch(() => null)
    if (paths === null) return { failed: 'The file search could not run.' }
    return { dir, files: await newestFirst(paths, limit) }
  }
}
