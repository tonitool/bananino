import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * app.js cannot be imported under node (electron), and nothing in boot-time code calls
 * the actions — so a controller whose creation block goes missing only explodes when the
 * user actually clicks, as it once did for the timer. This is the cheap tripwire.
 */
test('every controller the actions close over is actually created', async () => {
  const source = await readFile(join(ROOT, 'src', 'main', 'app.js'), 'utf8')

  for (const [binding, factory] of [
    ['timer', 'createTimer'],
    ['moco', 'createMocoSync'],
    ['meeting', 'createMeetingController'],
    ['music', 'createNowPlaying'],
    ['calendar', 'createCalendarSync'],
    ['clipboard', 'createClipboardWatcher'],
    ['mic', 'createMicBridge'],
  ]) {
    const created = source.includes(`const ${binding} = ${factory}(`)
    assert.ok(created, `app.js uses ${binding}.* in actions but never runs ${factory}()`)
  }
})

test('the actions object never references an undeclared variable by the usual names', async () => {
  const source = await readFile(join(ROOT, 'src', 'main', 'app.js'), 'utf8')
  const actionsBody = source.slice(source.indexOf('const actions = {'))

  // Position does not matter — closures resolve at call time — only existence does.
  for (const used of ['timer', 'moco', 'meeting', 'music', 'calendar', 'clipboard', 'perch', 'tray', 'mic']) {
    if (!new RegExp(`\\b${used}\\.`).test(actionsBody)) continue
    const declared = new RegExp(`const ${used} =`).test(source)
    assert.ok(declared, `actions use ${used}.* but no \`const ${used} =\` exists anywhere`)
  }
})
