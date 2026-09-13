import { execFile } from 'node:child_process'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

const run = promisify(execFile)

/**
 * Searching the Messages history on this Mac.
 *
 * Read-only, always: `sqlite3 -readonly` against Apple's own database, never a write and
 * never a copy left anywhere. macOS gates the file behind **Full Disk Access**, which is
 * the consent step this feature leans on — until you grant it in System Settings the read
 * fails, and the tool says so with the path to the switch rather than guessing.
 *
 * The awkward part is where the words live. Up to Big Sur a message's text was in
 * `message.text`; since then most rows leave that NULL and keep the text inside
 * `attributedBody`, a NeXTSTEP typedstream blob. A search that only reads `text` therefore
 * finds nothing at all on a current Mac — so rows are matched on either, and the blob is
 * decoded here.
 */

export const messagesDatabase = () => join(homedir(), 'Library', 'Messages', 'chat.db')

/** Field and row separators no message can contain, so multi-line texts survive the trip. */
const FIELD = '\u001f'
const ROW = '\u001e'

/** Apple counts from 2001-01-01; older rows count seconds, newer ones nanoseconds. */
const APPLE_EPOCH = 978307200

/** How many candidate rows are pulled back before the decoded text is re-checked. */
const CANDIDATES = 120

/**
 * A string as a SQL literal.
 *
 * The query is a person's words arriving from a language model, and the sqlite3 CLI takes
 * one statement as an argument rather than bound parameters — so this is the only thing
 * between "find messages about o'brien" and a broken (or worse, a second) statement.
 * Doubling the quote is SQL's own escape; the wildcards are neutered so a copied path full
 * of underscores searches for underscores.
 */
export const sqlString = (value) => `'${String(value ?? '').replace(/'/g, "''")}'`

export const likePattern = (value) =>
  `%${String(value ?? '').replace(/[\\%_]/g, (character) => `\\${character}`)}%`

/**
 * The blob half of the search, as LIKE patterns over `hex(attributedBody)`.
 *
 * Searching the hex is how a blob is found without decoding a hundred thousand of them:
 * the UTF-8 of a word appears in it verbatim. Bytes are bytes, though, so "friday" and
 * "Friday" are different needles — hence one anchor word in the spellings people actually
 * type. The longest word is the anchor because it is the least likely to appear by
 * accident, and a loose match costs nothing: `filterRows` reads the decoded text and
 * throws out whatever does not really contain the query.
 */
export const hexPatterns = (query) => {
  const words = String(query ?? '')
    .split(/\s+/)
    .filter(Boolean)
    .sort((a, b) => b.length - a.length)
  const anchor = words[0] ?? ''
  if (!anchor) return []

  const spellings = new Set([
    anchor,
    anchor.toLowerCase(),
    anchor.toUpperCase(),
    anchor[0].toUpperCase() + anchor.slice(1).toLowerCase(),
  ])

  return [...spellings].map(
    (spelling) => `%${Buffer.from(spelling, 'utf8').toString('hex').toUpperCase()}%`,
  )
}

/**
 * The statement: rows whose `text` matches, plus rows whose blob looks like it might.
 */
export const buildQuery = ({ query, limit = CANDIDATES }) => {
  const text = sqlString(likePattern(query))
  const blob = hexPatterns(query)
    .map((pattern) => `hex(m.attributedBody) LIKE ${sqlString(pattern)}`)
    .join(' OR ')

  return [
    'SELECT',
    `  strftime('%Y-%m-%d %H:%M', CASE WHEN m.date > 1000000000000 THEN m.date / 1000000000 ELSE m.date END + ${APPLE_EPOCH}, 'unixepoch', 'localtime'),`,
    '  m.is_from_me,',
    "  COALESCE(h.id, ''),",
    "  COALESCE(c.display_name, ''),",
    "  COALESCE(m.text, ''),",
    "  COALESCE(hex(m.attributedBody), '')",
    'FROM message m',
    'LEFT JOIN handle h ON h.ROWID = m.handle_id',
    'LEFT JOIN chat_message_join cmj ON cmj.message_id = m.ROWID',
    'LEFT JOIN chat c ON c.ROWID = cmj.chat_id',
    `WHERE m.text LIKE ${text} ESCAPE '\\'${blob ? ` OR ${blob}` : ''}`,
    'GROUP BY m.ROWID',
    'ORDER BY m.date DESC',
    `LIMIT ${Number.isInteger(limit) && limit > 0 ? limit : CANDIDATES};`,
  ].join('\n')
}

/**
 * The text inside a typedstream blob.
 *
 * Only as much of the format as a message needs: after the `NSString` class name the
 * archive writes a `+` marker, then the byte length — one byte under 128, otherwise 0x81
 * and a little-endian uint16 — then the UTF-8 itself. Anything else is left alone and the
 * row simply falls back to its `text` column, because a half-read blob is worse than none.
 */
export const decodeAttributedBody = (hex) => {
  if (!hex) return ''
  const buffer = Buffer.from(String(hex), 'hex')

  const marker = buffer.indexOf('NSString', 0, 'latin1')
  if (marker === -1) return ''

  const plus = buffer.indexOf(0x2b, marker)
  if (plus === -1) return ''

  let at = plus + 1
  let length = buffer[at]
  if (length === undefined) return ''

  if (length === 0x81) {
    if (at + 3 > buffer.length) return ''
    length = buffer.readUInt16LE(at + 1)
    at += 2
  } else if (length >= 0x80) {
    return ''
  }

  return buffer.subarray(at + 1, at + 1 + length).toString('utf8')
}

export const parseRows = (stdout) =>
  String(stdout ?? '')
    .split(ROW)
    .map((line) => line.split(FIELD))
    .filter((parts) => parts.length >= 6)
    .map(([when, fromMe, handle, chat, text, blob]) => ({
      when: when.trim(),
      fromMe: fromMe.trim() === '1',
      handle: handle.trim(),
      chat: chat.trim(),
      text: (text || decodeAttributedBody(blob.trim())).replace(/\s+/g, ' ').trim(),
    }))

/** Rows that really do contain the words, once the blob ones can be read. */
export const filterRows = (rows, query) => {
  const needle = String(query ?? '').trim().toLowerCase()
  return rows.filter((row) => row.text && row.text.toLowerCase().includes(needle))
}

/** '2026-09-11 14:02  Anna Calvi: are we still on for Friday' — one row, one line. */
export const formatRow = (row) => {
  const who = row.fromMe ? 'me' : row.handle || row.chat || 'unknown'
  const where = row.chat && !row.fromMe && row.chat !== row.handle ? ` in ${row.chat}` : ''
  return `${row.when}  ${who}${where}: ${row.text.slice(0, 200)}`
}

/** What macOS says when the app has not been given Full Disk Access. */
const BLOCKED = /unable to open database|authorization denied|operation not permitted|code:\s*14/i

export const FULL_DISK_ACCESS_HINT =
  'Messages are locked until Bananino has Full Disk Access: System Settings → Privacy & ' +
  'Security → Full Disk Access → add Bananino, then restart it.'

/**
 * The search itself. `exec` is injected so the whole path above can be tested off a Mac.
 */
export const searchMessages = async ({
  query,
  limit = 10,
  database = messagesDatabase(),
  exec = (args) => run('sqlite3', args, { timeout: 8_000, maxBuffer: 4 * 1024 * 1024 }),
}) => {
  const words = String(query ?? '').trim()
  if (!words) return { failed: 'No words were given to search for.' }

  try {
    const { stdout } = await exec([
      '-readonly',
      '-separator',
      FIELD,
      '-newline',
      ROW,
      database,
      buildQuery({ query: words }),
    ])
    return { messages: filterRows(parseRows(stdout), words).slice(0, limit) }
  } catch (error) {
    const message = `${error.stderr ?? ''}${error.message ?? ''}`
    if (BLOCKED.test(message)) return { blocked: true }
    if (/ENOENT/.test(message)) return { failed: 'This Mac has no Messages database to search.' }
    console.warn('[messages] could not be searched:', message.trim())
    return { failed: 'The Messages history could not be read.' }
  }
}
