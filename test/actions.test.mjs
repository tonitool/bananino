import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const MAIN = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'main')

/**
 * The IPC layer and the menus call into an `actions` object by name, so a rename or a
 * careless deletion is only discovered when a user clicks the thing. Removing the meeting
 * feature as a contiguous range took the MOCO actions with it, and the app crashed the
 * first time someone pressed Push.
 */
test('every action the IPC layer and menus call actually exists', async () => {
  const app = await readFile(join(MAIN, 'app.js'), 'utf8')
  const callers = await Promise.all(
    ['ipcHandlers.js', 'menu.js', 'tray.js'].map((file) => readFile(join(MAIN, file), 'utf8')),
  )

  const block = app.slice(app.indexOf('const actions = {'))
  const defined = new Set([...block.matchAll(/^ {4}([a-zA-Z][a-zA-Z0-9]*):/gm)].map(([, name]) => name))

  const referenced = new Set(
    callers.flatMap((source) => [...source.matchAll(/actions\.([a-zA-Z][a-zA-Z0-9]*)/g)].map(([, n]) => n)),
  )

  const missing = [...referenced].filter((name) => !defined.has(name)).sort()
  assert.deepEqual(missing, [], `actions referenced but not defined: ${missing.join(', ')}`)
})
