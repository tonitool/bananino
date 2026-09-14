import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { updateMenuEntry } from '../src/main/update/menuEntry.js'

const actions = { checkForUpdates: () => 'check', openUpdate: () => 'open' }

test('with nothing found yet, the menu offers a plain check', () => {
  const entry = updateMenuEntry(null, actions)
  assert.equal(entry.label, 'Check for updates')
  assert.equal(entry.click(), 'check')
  assert.notEqual(entry.enabled, false)
})

test('a found-but-still-downloading update says so, and cannot hurry it', () => {
  const entry = updateMenuEntry({ version: '1.3.1', state: 'downloading' }, actions)
  assert.equal(entry.label, 'Downloading v1.3.1…')
  assert.equal(entry.enabled, false)
})

test('a downloaded update offers the restart that installs it', () => {
  const entry = updateMenuEntry({ version: '1.3.1', state: 'ready' }, actions)
  assert.equal(entry.label, 'Restart Bananino for v1.3.1')
  assert.equal(entry.click(), 'open')
})

test('every updater method app.js calls is one the updater really returns', async () => {
  /*
   * The bug this exists for. app.js called `updates.open?.(pendingUpdate.url)` — a method
   * the updater has never had, on a property the pending update has never had — and the
   * optional call swallowed both. The menu bar said "Restart Bananino for v1.6.1" and
   * clicking it did nothing at all, for three releases, while the app updated only when
   * quit for some other reason.
   *
   * Checked as text because app.js and updater.js both reach electron and cannot be
   * imported under plain node.
   */
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  const updater = await readFile(join(root, 'src', 'main', 'update', 'updater.js'), 'utf8')
  const app = await readFile(join(root, 'src', 'main', 'app.js'), 'utf8')

  /*
   * Every object the module returns — the working one and every early-out stub. Found by
   * counting braces rather than by regex: an object holding arrow functions has braces of
   * its own, and a pattern that stops at the first `}` reads half a shape.
   */
  const shapes = []
  for (let at = updater.indexOf('return {'); at !== -1; at = updater.indexOf('return {', at + 1)) {
    let depth = 0
    let end = at + 7
    for (; end < updater.length; end += 1) {
      if (updater[end] === '{') depth += 1
      if (updater[end] === '}') {
        depth -= 1
        if (depth === 0) break
      }
    }
    const body = updater.slice(at + 8, end)
    const names = [...body.matchAll(/^\s{4,6}([A-Za-z]\w*):/gm)].map(([, name]) => name)
    if (names.length > 0) shapes.push(new Set(names))
  }
  assert.ok(shapes.length >= 2, `expected the real updater and at least one stub, found ${shapes.length}`)

  const called = new Set([...app.matchAll(/\bupdates\.(\w+)/g)].map(([, name]) => name))
  assert.ok(called.size > 0, 'app.js does not use the updater at all')

  for (const name of called) {
    for (const [index, shape] of shapes.entries()) {
      assert.ok(shape.has(name), `app.js calls updates.${name}, which shape ${index} does not have`)
    }
  }

  // And the restart menu item has to reach the thing that actually installs.
  assert.match(app, /updates\.install\(\)/)
  assert.doesNotMatch(app, /updates\.\w+\?\./, 'an optional call hides a misspelt method')
})
