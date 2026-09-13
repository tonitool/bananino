import assert from 'node:assert/strict'
import test from 'node:test'
import { createFileSearch, formatFile, resolveFolder } from '../src/main/storage/fileSearch.js'

const HOME = '/Users/me'
const known = (name) => `${HOME}/${name[0].toUpperCase()}${name.slice(1)}`

const at = (iso) => ({ mtime: new Date(iso) })

/** A Mac with a few files on it, dated so the ordering has something to prove. */
const fakeMac = ({ hits = [], folder = {}, times = {} } = {}) => {
  const asked = []
  return {
    asked,
    mdfind: async (args) => (asked.push(args), hits),
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
  assert.deepEqual(mac.asked, [['-onlyin', '/Users/me/Downloads', 'invoice']])
  assert.deepEqual(outcome.files.map(({ path }) => path), ['/Users/me/Downloads/invoice-44.pdf'])

  // Without a folder it is the whole Mac, as before.
  await search({ query: 'invoice' })
  assert.deepEqual(mac.asked.at(-1), ['invoice'])
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

test('a folder nobody can find says so, rather than searching everything', async () => {
  const search = createFileSearch(fakeMac())

  assert.match((await search({ query: 'invoice', folder: 'wherever' })).failed, /do not know where/)
  assert.match((await search({ folder: '/Users/me/Nope' })).failed, /no folder at/)
  assert.match((await search({})).failed, /No search words/)
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
