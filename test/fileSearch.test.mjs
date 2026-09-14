import assert from 'node:assert/strict'
import test from 'node:test'
import { createFileSearch, formatFile, resolveFolder } from '../src/main/storage/fileSearch.js'

const HOME = '/Users/me'
const known = (name) => `${HOME}/${name[0].toUpperCase()}${name.slice(1)}`

const at = (iso) => ({ mtime: new Date(iso) })

/**
 * A Mac with a few files on it, dated so the ordering has something to prove.
 *
 * `hits` may be a list (every search finds it) or a function of the arguments, for the
 * tests that care which of the two Spotlight passes — by name, then by anything — found
 * what, or that a folder was looked up before it was searched.
 */
const fakeMac = ({ hits = [], folder = {}, times = {} } = {}) => {
  const asked = []
  return {
    asked,
    mdfind: async (args) => (asked.push(args), typeof hits === 'function' ? hits(args) : hits),
    readFolder: async (dir) => {
      if (!folder[dir]) throw new Error('ENOENT')
      return folder[dir]
    },
    statFile: async (path) => times[path] ?? at('2020-01-01T00:00:00Z'),
    home: HOME,
    known,
  }
}

test('a folder is found however it was said', () => {
  // All four turn up from a model for the same folder, so all four resolve — and the
  // well-known ones come from the OS rather than from ~/Downloads guessed at.
  for (const said of ['Downloads', 'downloads', 'my downloads folder', 'the Downloads']) {
    assert.equal(resolveFolder(said, { home: HOME, known }), '/Users/me/Downloads')
  }
  assert.equal(resolveFolder('~/Projects', { home: HOME, known }), '/Users/me/Projects')
  assert.equal(resolveFolder('/Volumes/Work', { home: HOME, known }), '/Volumes/Work')

  // Anything else is refused rather than guessed at: searching the wrong folder looks
  // exactly like finding nothing.
  assert.equal(resolveFolder('wherever I put it', { home: HOME, known }), null)
})

test('a named folder narrows Spotlight instead of being searched for as a word', async () => {
  // The bug this closes: "the invoice in my Downloads" used to search the whole Mac for
  // the words invoice and downloads, which finds everything and the file least of all.
  const mac = fakeMac({ hits: ['/Users/me/Downloads/invoice-44.pdf'] })
  const search = createFileSearch(mac)

  const outcome = await search({ query: 'invoice', folder: 'Downloads' })
  // By name first — "find this file" means the name, not every document mentioning it —
  // and then by anything, because the other half of the time the words are inside it.
  assert.deepEqual(mac.asked, [
    ['-onlyin', '/Users/me/Downloads', '-name', 'invoice'],
    ['-onlyin', '/Users/me/Downloads', 'invoice'],
  ])
  assert.deepEqual(outcome.files.map(({ path }) => path), ['/Users/me/Downloads/invoice-44.pdf'])

  // Without a folder it is the whole Mac, as before.
  await search({ query: 'invoice' })
  assert.deepEqual(mac.asked.at(-1), ['invoice'])
})

test('a folder this Mac has never heard of is found, not asked about', async () => {
  /*
   * The report this is here for: "find 16x9_Architekt in the JuniorDepot folder" was met
   * with "I don't know where that is, give me the full path" — three times over. A folder
   * is the one thing Spotlight is certain to be able to find, so it is looked up.
   */
  const mac = fakeMac({
    hits: (args) => {
      if (args[0]?.startsWith('kMDItemContentType')) return ['/Users/me/Work/JuniorDepot']
      return ['/Users/me/Work/JuniorDepot/16x9_Architekt.mp4']
    },
  })

  const outcome = await createFileSearch(mac)({ query: '16x9_Architekt', folder: 'JuniorDepot' })

  assert.match(mac.asked[0][0], /kMDItemFSName == "JuniorDepot"c/)
  assert.deepEqual(mac.asked[1], ['-onlyin', '/Users/me/Work/JuniorDepot', '-name', '16x9_Architekt'])
  assert.deepEqual(outcome.dirs, ['/Users/me/Work/JuniorDepot'])
  assert.deepEqual(outcome.files.map(({ path }) => path), ['/Users/me/Work/JuniorDepot/16x9_Architekt.mp4'])
})

test('a folder that exists nowhere narrows the whole Mac by its name', async () => {
  // Still better than a question back: search everywhere, keep what sits under something
  // of that name, and say plainly that is what happened.
  const mac = fakeMac({
    hits: (args) => {
      if (args[0]?.startsWith('kMDItemContentType')) return []
      return ['/Users/me/Archive/juniordepot/old.mp4', '/Users/me/Other/unrelated.mp4']
    },
  })

  const outcome = await createFileSearch(mac)({ query: 'mp4', folder: 'JuniorDepot' })
  assert.deepEqual(outcome.dirs, [])
  assert.equal(outcome.within, 'juniordepot')
  assert.deepEqual(outcome.files.map(({ path }) => path), ['/Users/me/Archive/juniordepot/old.mp4'])
})

test('results come back newest first, which is what the tool always claimed', async () => {
  // Spotlight answers in index order, so "the one from yesterday" was unanswerable: the
  // ten paths taken were arbitrary. Dating them is the whole point.
  const mac = fakeMac({
    hits: ['/a/old.pdf', '/a/newest.pdf', '/a/middle.pdf'],
    times: {
      '/a/old.pdf': at('2026-01-02T09:00:00Z'),
      '/a/newest.pdf': at('2026-09-12T14:03:00Z'),
      '/a/middle.pdf': at('2026-06-01T10:00:00Z'),
    },
  })

  const outcome = await createFileSearch(mac)({ query: 'pdf' })
  assert.deepEqual(
    outcome.files.map(({ path }) => path),
    ['/a/newest.pdf', '/a/middle.pdf', '/a/old.pdf'],
  )
  assert.equal(formatFile(outcome.files[0]), '2026-09-12 14:03  /a/newest.pdf')
})

test('a folder with no words is "what did I download", newest first', async () => {
  const mac = fakeMac({
    folder: { '/Users/me/Downloads': ['.DS_Store', 'invoice.pdf', 'deck.key'] },
    times: {
      '/Users/me/Downloads/invoice.pdf': at('2026-09-12T08:00:00Z'),
      '/Users/me/Downloads/deck.key': at('2026-09-13T08:00:00Z'),
    },
  })

  const outcome = await createFileSearch(mac)({ folder: 'downloads' })
  assert.deepEqual(
    outcome.files.map(({ path }) => path),
    ['/Users/me/Downloads/deck.key', '/Users/me/Downloads/invoice.pdf'],
  )
  // Spotlight was never asked, and the Mac's own housekeeping is not an answer.
  assert.deepEqual(mac.asked, [])
})

test('a refusal from macOS is not reported as an empty folder', async () => {
  /*
   * The other half of the JuniorDepot report: asked to list Downloads, the answer was
   * "there is no folder there, or it might be empty". Downloads, Desktop and Documents
   * are all behind a permission, and an app that has not been granted it must say which
   * switch to flip rather than describe the folder as missing.
   */
  const mac = fakeMac()
  mac.readFolder = async () => {
    throw Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' })
  }

  const outcome = await createFileSearch(mac)({ folder: 'Downloads' })
  assert.match(outcome.failed, /Privacy & Security → Files and Folders/)
  assert.doesNotMatch(outcome.failed, /empty/)
})

test('a search that times out or floods says which, instead of "could not run"', async () => {
  // One sentence for every failure taught the model to invent reasons for them.
  const slow = fakeMac()
  slow.mdfind = async () => {
    throw Object.assign(new Error('spawn mdfind ETIMEDOUT'), { code: 'ETIMEDOUT' })
  }
  assert.match((await createFileSearch(slow)({ query: 'mp3' })).failed, /took too long/)

  const flood = fakeMac()
  flood.mdfind = async () => {
    throw Object.assign(new Error('stdout maxBuffer length exceeded'), { code: 'ENOBUFS' })
  }
  assert.match((await createFileSearch(flood)({ query: 'mp3' })).failed, /more specific word/)
})

test('nothing to go on is still a plain answer', async () => {
  const search = createFileSearch(fakeMac())
  assert.match((await search({})).failed, /No search words/)
  // A folder that cannot be found, and no words either: nothing to search for at all.
  assert.match((await search({ folder: 'wherever' })).failed, /could not find a folder/)
})

test('a file that has moved since Spotlight indexed it is dropped', async () => {
  // mdfind happily returns a path that is no longer there; a path you cannot open is a
  // path not found, so it never reaches the answer.
  const mac = fakeMac({ hits: ['/a/gone.pdf', '/a/here.pdf'] })
  mac.statFile = async (path) => {
    if (path === '/a/gone.pdf') throw new Error('ENOENT')
    return at('2026-09-12T08:00:00Z')
  }

  const outcome = await createFileSearch(mac)({ query: 'pdf' })
  assert.deepEqual(outcome.files.map(({ path }) => path), ['/a/here.pdf'])
})
