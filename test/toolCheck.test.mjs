import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runToolCheck } from '../src/main/toolCheck.js'
import { cardOffer } from '../src/renderer/ui/panel/chatTab.js'

/** A Mac where everything works, unless a test says otherwise. */
const working = (overrides = {}) => ({
  searchFiles: async ({ folder }) =>
    folder === 'Downloads'
      ? { files: [{ path: '/Users/me/Downloads/asset1.png', modified: new Date() }] }
      : { files: [{ path: '/Users/me/Pictures/a.png', modified: new Date() }] },
  searchMessages: async () => ({ lines: ['2026-09-14 09:00  me: the thing'] }),
  music: { current: async () => ({ title: 'Sun', artist: 'Caribou', playerLabel: 'Spotify' }) },
  isAccessibilityTrusted: () => true,
  home: '/Users/me',
  ...overrides,
})

const by = (checks, label) => checks.find((check) => check.label === label)

test('a working Mac says what it found, not just that it worked', async () => {
  // "ok" on its own only means the code did not throw. A count and an example are the
  // difference between a check and a decoration.
  const checks = await runToolCheck(working())

  assert.equal(by(checks, 'Files · Downloads').state, 'ok')
  assert.match(by(checks, 'Files · Downloads').detail, /asset1\.png/)
  assert.equal(by(checks, 'Messages').state, 'ok')
  assert.match(by(checks, 'Music').detail, /Sun — Caribou/)
  assert.equal(by(checks, 'Rewrite (⌃⌥R)').state, 'ok')
})

test('a withheld folder is a warning with the pane to open, not a failure to interpret', async () => {
  const checks = await runToolCheck(
    working({
      searchFiles: async ({ folder }) =>
        folder === 'Downloads'
          ? { failed: 'macOS is not letting Bananino into /Users/me/Downloads. … Files and Folders → Bananino.' }
          : { files: [] },
      searchMessages: async () => ({ blocked: true, hint: 'Full Disk Access → add Bananino' }),
      isAccessibilityTrusted: () => false,
    }),
  )

  assert.equal(by(checks, 'Files · Downloads').state, 'failed')
  assert.match(by(checks, 'Files · Downloads').detail, /Files and Folders/)
  assert.equal(by(checks, 'Messages').state, 'warn')
  assert.match(by(checks, 'Messages').detail, /Full Disk Access/)
  assert.match(by(checks, 'Rewrite (⌃⌥R)').detail, /Accessibility/)
})

test('an empty Downloads is flagged, because that is what a withheld one looks like too', async () => {
  // The trap this check exists to expose: macOS hands a forbidden folder back as empty
  // rather than refusing it, so "nothing here" cannot be reported as plain success.
  const checks = await runToolCheck(working({ searchFiles: async () => ({ files: [] }) }))

  assert.equal(by(checks, 'Files · Downloads').state, 'warn')
  assert.match(by(checks, 'Files · Downloads').detail, /withholding/)
})

test('a probe that throws is one failed line, not a dead check run', async () => {
  const checks = await runToolCheck(
    working({
      searchFiles: async () => {
        throw new Error('mdfind is missing')
      },
    }),
  )

  assert.equal(by(checks, 'Files · Downloads').state, 'failed')
  assert.match(by(checks, 'Files · Downloads').detail, /mdfind is missing/)
  // And the rest still ran, which is the point of checking one thing at a time.
  assert.equal(by(checks, 'Messages').state, 'ok')
})

test('a read card offers its answer, so a model that will not say it cannot hide it', () => {
  /*
   * The report this closes: "I cannot run the file search right now... and didn't find any
   * matches for asset1" — over a Downloads folder that visibly contained asset1.png. Two
   * contradictory answers in one sentence, neither of them necessarily the tool's. The
   * card's summary is a count, so when the prose disagrees with it there was nowhere to
   * read what actually came back. Now there is.
   */
  assert.equal(
    cardOffer({ status: 'read', detail: '3 results', told: '/a/asset1.png\n/a/asset2.png\n/a/asset3.png' }),
    'answer',
  )

  // A one-line answer is already on the card; offering to show it again is noise.
  assert.equal(cardOffer({ status: 'read', detail: '/a/one.png', told: '/a/one.png' }), null)
  assert.equal(cardOffer({ status: 'read', detail: 'nothing came back', told: '' }), null)

  // And the pill an act carries is untouched — it is the same one button.
  assert.equal(cardOffer({ status: 'undoable' }), 'Undo')
  assert.equal(cardOffer({ status: 'proposed' }), 'Do it')
  assert.equal(cardOffer({ status: 'failed' }), null)
})

test('the whole read answer reaches the view, not just its summary', async () => {
  /*
   * Checked as text because session.js cannot be imported under plain node. The state
   * projection lists fields one by one, so a read's `told` is exactly the kind of thing
   * that gets left off and leaves the card with nothing to show.
   */
  const source = await readFile(
    join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'main', 'chat', 'session.js'),
    'utf8',
  )
  const projection = source.slice(source.indexOf('const state = () => ({'), source.indexOf('const publish'))
  assert.match(projection, /status === 'read' \? \{ told: message\.told \}/)
})
