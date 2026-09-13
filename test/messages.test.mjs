import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildQuery,
  decodeAttributedBody,
  filterRows,
  formatRow,
  hexPatterns,
  likePattern,
  parseRows,
  searchMessages,
  sqlString,
} from '../src/main/messages/search.js'

/** A typedstream blob shaped the way Messages writes one, around a given text. */
const attributedBody = (text) => {
  const body = Buffer.from(text, 'utf8')
  const length =
    body.length < 0x80
      ? Buffer.from([body.length])
      : Buffer.from([0x81, body.length & 0xff, body.length >> 8])

  return Buffer.concat([
    Buffer.from('040b73747265616d747970656481e8038401408484', 'hex'),
    Buffer.from([0x84, 0x12]),
    Buffer.from('NSString', 'latin1'),
    Buffer.from([0x01, 0x94, 0x84, 0x01, 0x2b]),
    length,
    body,
  ])
    .toString('hex')
    .toUpperCase()
}

const FIELD = '\u001f'
const ROW = '\u001e'

const row = (fields) => fields.join(FIELD)

test('a message whose text lives in the blob is read anyway', () => {
  // Since Big Sur most rows leave `text` NULL and keep the words in `attributedBody`, so a
  // search that only read the column would come back empty on every current Mac.
  assert.equal(decodeAttributedBody(attributedBody('are we still on for Friday?')), 'are we still on for Friday?')

  // And the two-byte length form, which anything past a sentence or two uses.
  const long = 'x'.repeat(400)
  assert.equal(decodeAttributedBody(attributedBody(long)), long)

  // A blob in a shape this does not understand gives nothing rather than a half-read mess.
  assert.equal(decodeAttributedBody('DEADBEEF'), '')
  assert.equal(decodeAttributedBody(''), '')
})

test('a quote in the words searched for cannot end the statement', () => {
  // The words come from a model, and the sqlite3 CLI takes a statement rather than bound
  // parameters — so this escape is the whole defence.
  assert.equal(sqlString("o'brien"), "'o''brien'")
  assert.match(buildQuery({ query: "'; DROP TABLE message; --" }), /'%''; DROP TABLE message; --%'/)

  // Wildcards in a copied path search for themselves instead of matching everything.
  assert.equal(likePattern('50%_x'), '%50\\%\\_x%')
})

test('the blob is searched in the spellings people actually type', () => {
  // Hex is bytes, so "friday" and "Friday" are different needles; the anchor is the longest
  // word because it is the least likely to turn up by accident.
  const patterns = hexPatterns('the friday plan')
  // Three here rather than four: the word was typed in one of the spellings already.
  assert.equal(patterns.length, 3)
  assert.ok(patterns.includes(`%${Buffer.from('friday').toString('hex').toUpperCase()}%`))
  assert.ok(patterns.includes(`%${Buffer.from('Friday').toString('hex').toUpperCase()}%`))
  assert.ok(patterns.includes(`%${Buffer.from('FRIDAY').toString('hex').toUpperCase()}%`))
  assert.deepEqual(hexPatterns('   '), [])
})

test('rows keep their text even when it runs over several lines', () => {
  // Messages contain newlines and tabs, so the rows arrive separated by control characters
  // no message can hold — a newline-separated read would split one message into two.
  const stdout = [
    row(['2026-09-11 14:02', '0', '+4915112345678', 'Studio', 'dinner\non friday?', '']),
    row(['2026-09-11 14:05', '1', '+4915112345678', 'Studio', '', attributedBody('yes — 8pm')]),
  ].join(ROW)

  const rows = parseRows(stdout)
  assert.equal(rows.length, 2)
  assert.equal(rows[0].text, 'dinner on friday?')
  assert.equal(rows[1].text, 'yes — 8pm')
  assert.equal(rows[1].fromMe, true)

  assert.equal(formatRow(rows[0]), '2026-09-11 14:02  +4915112345678 in Studio: dinner on friday?')
  assert.equal(formatRow(rows[1]), '2026-09-11 14:05  me: yes — 8pm')
})

test('a row the hex search only half matched is dropped once it can be read', () => {
  // The hex LIKE can match across a byte boundary, which is why the decoded text is the
  // thing that decides.
  const rows = [{ text: 'dinner on friday' }, { text: 'nothing to do with it' }]
  assert.deepEqual(filterRows(rows, 'FRIDAY'), [{ text: 'dinner on friday' }])
})

test('a locked database asks for Full Disk Access instead of reporting no messages', async () => {
  // The failure mode worth getting right: without the permission macOS simply refuses the
  // file, and "no messages found" would be a lie that sends the user looking in Messages.
  const denied = Object.assign(new Error('Error: unable to open database file'), {
    stderr: 'Error: unable to open database "chat.db": unable to open database file',
  })

  assert.deepEqual(await searchMessages({ query: 'dinner', exec: async () => { throw denied } }), {
    blocked: true,
  })

  assert.match((await searchMessages({ query: '  ' })).failed, /No words were given/)
})

test('the search asks sqlite for a read and nothing else', async () => {
  let args = null
  const outcome = await searchMessages({
    query: 'dinner',
    database: '/tmp/chat.db',
    exec: async (given) => {
      args = given
      return { stdout: row(['2026-09-11 14:02', '0', 'anna@example.com', '', 'dinner at eight', '']) }
    },
  })

  assert.ok(args.includes('-readonly'), 'the database was not opened read-only')
  assert.ok(args.includes('/tmp/chat.db'))
  assert.match(args.at(-1), /^SELECT/)
  assert.deepEqual(outcome.messages.map((message) => message.text), ['dinner at eight'])
})
