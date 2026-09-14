/**
 * Finding a file the way it gets asked for: "the invoice in my Downloads", "what did I
 * download yesterday", "16x9_Architekt, it's in JuniorDepot somewhere".
 *
 * That last one is the shape this module kept failing on. It only knew seven folder names
 * — Downloads, Desktop, Documents and a few more — and refused anything else, so a buddy
 * asked for a file in a project folder answered by asking the user where the folder was.
 * Which is absurd: a folder is precisely the kind of thing Spotlight can find. Now an
 * unrecognised name is *looked up*, and only if no folder anywhere has that name does the
 * search widen to the whole Mac and keep the hits whose path mentions it.
 *
 * The other lesson in here is about failure. Every way this can go wrong used to arrive as
 * the same sentence — "the file search could not run" — which tells a model nothing, so it
 * guessed: "no matches, or the folder might be empty". A permission macOS withheld, a
 * search that timed out, and a folder that genuinely is empty are three different answers,
 * and the one that matters most is the first: Downloads, Desktop and Documents are
 * protected, and an app that has not been let in sees them as empty rather than refused.
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
 * A folder as an absolute path, when the name alone settles it.
 *
 * "Downloads", "downloads folder", "~/Downloads" and "/Users/me/Downloads" all arrive from
 * a model for the same folder, so all four resolve here. Anything else returns null — not
 * as a refusal any more, but as "this one has to be looked up".
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

/**
 * A value made safe to sit inside an mdfind query expression.
 *
 * The expression is built here and the words come from a model, so a stray quote would
 * change what is being asked rather than what is being searched for.
 */
export const quoteMdfind = (value) =>
  String(value ?? '')
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/["\\]/g, '')
    .trim()
    .slice(0, 120)

/** The query that finds a folder by its name, case-insensitively. */
export const folderQuery = (name) =>
  `kMDItemContentType == "public.folder" && kMDItemFSName == "${quoteMdfind(name)}"c`

/** How many hits are dated before the newest are picked — a stat each, so bounded. */
const CANDIDATES = 80

/** How many folders of the same name are worth searching before it stops being a scope. */
const MAX_FOLDERS = 5

/** '2026-09-12 14:03  /Users/me/Downloads/invoice.pdf' — the date is how you tell two apart. */
export const formatFile = ({ path, modified }) =>
  modified ? `${modified.toISOString().slice(0, 16).replace('T', ' ')}  ${path}` : path

/**
 * Why a search died, in words the chat can pass on.
 *
 * The three that actually happen, named rather than lumped together: macOS withholding a
 * folder, a whole-Mac search that outran its timeout, and a query so broad the output did
 * not fit. Each one has a different thing for the user to do about it.
 */
export const describeFailure = (error, { dir } = {}) => {
  const code = error?.code ?? ''
  const message = `${error?.stderr ?? ''}${error?.message ?? ''}`

  if (code === 'EPERM' || code === 'EACCES' || /operation not permitted/i.test(message)) {
    return (
      `macOS is not letting Bananino into ${dir ?? 'that folder'}. Downloads, Desktop and ` +
      'Documents each need permission: System Settings → Privacy & Security → Files and ' +
      'Folders → Bananino.'
    )
  }
  if (code === 'ENOENT') return `There is no folder at ${dir ?? 'that path'}.`
  if (code === 'ENOTDIR') return `${dir ?? 'That path'} is a file, not a folder.`
  if (code === 'ENOBUFS' || /maxBuffer/i.test(message)) {
    return 'That search matched more than I can read at once — try a more specific word.'
  }
  if (code === 'ETIMEDOUT' || /timed out|killed/i.test(message)) {
    return 'That search took too long. Naming a folder to look in makes it quick.'
  }
  return `The file search could not run: ${message.trim() || 'unknown error'}`
}

export const createFileSearch = ({ mdfind, statFile, readFolder, home, known }) => {
  /** Dated and sorted, newest first. Anything that cannot be stat'd has gone: drop it. */
  const newestFirst = async (paths, limit) => {
    const dated = await Promise.all(
      [...new Set(paths)].slice(0, CANDIDATES).map(async (path) => {
        const found = await statFile(path).catch(() => null)
        return found ? { path, modified: found.mtime } : null
      }),
    )

    return dated
      .filter(Boolean)
      .sort((a, b) => b.modified - a.modified)
      .slice(0, limit)
  }

  /**
   * Where to look.
   *
   * Three answers, in the order they are worth trying: a name this Mac knows, a folder
   * Spotlight can find by that name, or nowhere in particular — in which case the name
   * becomes a filter on the paths that come back, because "in JuniorDepot" is still a
   * useful thing to know even when no folder of that name can be found.
   */
  const locate = async (folder) => {
    const direct = resolveFolder(folder, { home, known })
    if (direct) return { dirs: [direct] }

    const found = await mdfind([folderQuery(folder)]).catch(() => [])
    if (found.length > 0) return { dirs: found.slice(0, MAX_FOLDERS) }

    return { dirs: [], within: String(folder).trim().toLowerCase() }
  }

  /**
   * One pass over Spotlight: by file name first, then by everything else.
   *
   * `-name` is the one people mean by "find this file" — it matches the name rather than
   * the contents, so "16x9_Architekt" finds the file called that instead of every document
   * that happens to mention it. The general search still runs, because the other half of
   * the time the words are a phrase inside the file.
   */
  const spotlight = async (words, dir) => {
    const scope = dir ? ['-onlyin', dir] : []
    const byName = await mdfind([...scope, '-name', words])
    const byAnything = await mdfind([...scope, words])
    return [...byName, ...byAnything]
  }

  return async ({ query, folder, limit = 10 } = {}) => {
    const words = String(query ?? '').trim()
    const asked = String(folder ?? '').trim()

    let dirs = []
    let within = null
    if (asked) {
      try {
        ;({ dirs, within = null } = await locate(asked))
      } catch (error) {
        return { failed: describeFailure(error) }
      }
    }

    // A folder and no words is "what is in there" — a list, newest first, not a search.
    if (!words) {
      if (dirs.length === 0) {
        return {
          failed: asked
            ? `I could not find a folder called "${asked}", and no words to search for.`
            : 'No search words were given.',
        }
      }

      const listed = []
      for (const dir of dirs) {
        try {
          const names = await readFolder(dir)
          // Dotfiles are the Mac's business, not the user's; .DS_Store is never the answer.
          listed.push(...names.filter((name) => !name.startsWith('.')).map((name) => `${dir}/${name}`))
        } catch (error) {
          // One unreadable folder out of several is not the whole answer being lost.
          if (dirs.length === 1) return { failed: describeFailure(error, { dir }) }
        }
      }
      return { dirs, files: await newestFirst(listed, limit) }
    }

    let hits = []
    try {
      if (dirs.length === 0) hits = await spotlight(words, null)
      else for (const dir of dirs) hits.push(...(await spotlight(words, dir)))
    } catch (error) {
      return { failed: describeFailure(error, { dir: dirs[0] }) }
    }

    /*
     * The last resort, and the reason "it's in JuniorDepot somewhere" works at all: the
     * folder could not be found, so the whole Mac was searched and only the hits whose
     * path mentions the name are kept. Better a narrowed guess than a question back.
     */
    if (within) {
      const inside = hits.filter((path) => path.toLowerCase().includes(within))
      if (inside.length > 0) return { dirs, within, files: await newestFirst(inside, limit) }
    }

    return { dirs, within, files: await newestFirst(hits, limit) }
  }
}
