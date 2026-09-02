import assert from 'node:assert/strict'
import test from 'node:test'
import { parseEntries, removeEntry } from '../src/main/storage/noteMarkdown.js'

const DAY = `# Tuesday, 2 September 2026

## 09:15
First note

## 11:30
Second note
over two lines

## 14:00
Third note
`

test('entries are parsed in file order with their index', () => {
  const entries = parseEntries(DAY)
  assert.deepEqual(
    entries.map((e) => [e.index, e.time, e.text]),
    [
      [0, '09:15', 'First note'],
      [1, '11:30', 'Second note\nover two lines'],
      [2, '14:00', 'Third note'],
    ],
  )
})

test('removing an entry keeps the others and the header intact', () => {
  const next = removeEntry(DAY, 1)
  const entries = parseEntries(next)

  assert.deepEqual(entries.map((e) => e.time), ['09:15', '14:00'])
  assert.match(next, /^# Tuesday, 2 September 2026/)
  assert.doesNotMatch(next, /over two lines/)
})

test('removing the last remaining entry leaves just the header', () => {
  const single = '# A day\n\n## 09:00\nOnly note\n'
  assert.equal(parseEntries(removeEntry(single, 0)).length, 0)
  assert.match(removeEntry(single, 0), /^# A day/)
})

test('an unknown index changes nothing', () => {
  assert.equal(parseEntries(removeEntry(DAY, 99)).length, 3)
})

test('a note containing something heading-shaped cannot corrupt the file', () => {
  // Rebuilt from parsed entries rather than cut out of raw text, so this stays one note.
  const tricky = '# A day\n\n## 09:00\nsee the notes below\n\n## 10:00\nsecond\n'
  const entries = parseEntries(tricky)
  assert.equal(entries.length, 2)

  const next = removeEntry(tricky, 0)
  assert.deepEqual(parseEntries(next).map((e) => e.text), ['second'])
})
