import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { matchesTerms, searchNotes } from '../src/main/storage/noteSearch.js'

const day = (entries) =>
  `# A day\n${entries.map(([time, text]) => `\n## ${time}\n${text}\n`).join('')}`

const withNotes = async (files, run) => {
  const dir = await mkdtemp(join(tmpdir(), 'bananino-notes-'))
  try {
    for (const [name, contents] of Object.entries(files)) {
      await writeFile(join(dir, name), contents, 'utf8')
    }
    await run(dir)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

test('every word has to be there, in any order and any case', () => {
  assert.equal(matchesTerms('Kickoff with Schaeffler', ['schaeffler', 'kickoff']), true)
  assert.equal(matchesTerms('Kickoff with Schaeffler', ['kickoff', 'invoice']), false)
  // An empty query matches nothing rather than everything: "find my notes about" with no
  // subject should come back with a question, not the whole year.
  assert.equal(matchesTerms('anything', []), false)
})

test('notes are found across days, newest first', async () => {
  await withNotes(
    {
      '2026-09-09.md': day([['09:15', 'Kickoff with Schaeffler — three workstreams']]),
      '2026-09-11.md': day([
        ['10:00', 'Standup'],
        ['16:20', 'Schaeffler kickoff follow-up: they want the deck by Friday'],
      ]),
      'notes.txt': 'not a day file',
    },
    async (dir) => {
      const found = await searchNotes({ dir, query: 'schaeffler kickoff' })

      assert.deepEqual(
        found.map(({ date, time }) => `${date} ${time}`),
        ['2026-09-11 16:20', '2026-09-09 09:15'],
      )
      assert.match(found[0].text, /deck by Friday/)
    },
  )
})

test('the search stops at the limit instead of reading the whole year', async () => {
  const files = Object.fromEntries(
    Array.from({ length: 20 }, (_, index) => [
      `2026-09-${String(index + 1).padStart(2, '0')}.md`,
      day([['09:00', 'invoice sent']]),
    ]),
  )

  await withNotes(files, async (dir) => {
    const found = await searchNotes({ dir, query: 'invoice', limit: 3 })
    assert.equal(found.length, 3)
    assert.deepEqual(
      found.map(({ date }) => date),
      ['2026-09-20', '2026-09-19', '2026-09-18'],
    )
  })
})

test('a folder with no notes in it is empty, not an error', async () => {
  assert.deepEqual(await searchNotes({ dir: '/nowhere/at/all', query: 'anything' }), [])
})
