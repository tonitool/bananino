import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  clashingShortcuts,
  describeAccelerator,
  fromKeyboardEvent,
  isAccelerator,
  normaliseAccelerator,
  sanitiseShortcuts,
} from '../src/main/accelerators.js'
import { DEFAULT_SHORTCUTS, SHORTCUT_MENU } from '../src/main/constants.js'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** A DOM keydown, as the recorder sees it. */
const press = (code, held = {}) => ({
  code,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  ...held,
})

test('a chord needs a real modifier, because it is claimed system-wide', () => {
  // The rule worth being strict about: a global shortcut owns that combination in every
  // app, so a bare key — or Shift and a key — would swallow ordinary typing everywhere.
  assert.equal(normaliseAccelerator('R'), null)
  assert.equal(normaliseAccelerator('Shift+A'), null)
  assert.equal(normaliseAccelerator(''), null)
  assert.equal(normaliseAccelerator('Control+Alt'), null)
  assert.equal(normaliseAccelerator('Control+Alt+R+T'), null)
  assert.equal(normaliseAccelerator('Control+Alt+Fnord'), null)

  assert.equal(isAccelerator('Control+Alt+R'), true)
  assert.equal(isAccelerator('Command+Shift+4'), true)
  assert.equal(isAccelerator('Alt+F12'), true)
})

test('one chord has one spelling, whatever it was typed as', () => {
  // Otherwise the same keys saved from two places compare unequal, and the clash warning
  // in the pane misses the clash it exists to catch.
  assert.equal(normaliseAccelerator('cmd+shift+k'), 'Command+Shift+K')
  assert.equal(normaliseAccelerator('Shift+Option+Ctrl+space'), 'Control+Alt+Shift+Space')
  assert.equal(normaliseAccelerator('CmdOrCtrl+,'.replace(',', 'Comma')), 'Command+Comma')
})

test('a chord is drawn the way the keycaps read', () => {
  assert.equal(describeAccelerator('Control+Alt+R'), '⌃⌥R')
  assert.equal(describeAccelerator('Command+Shift+Space'), '⇧⌘␣')
  assert.equal(describeAccelerator('nonsense'), '')
})

test('the recorder reads the physical key, not the character it types', () => {
  // On a Mac ⌥R types "®". A recorder that trusted event.key would register a shortcut for
  // a character no keyboard can produce without that same modifier.
  assert.equal(fromKeyboardEvent(press('KeyR', { ctrlKey: true, altKey: true })), 'Control+Alt+R')
  assert.equal(fromKeyboardEvent(press('Digit5', { metaKey: true, shiftKey: true })), 'Command+Shift+5')
  assert.equal(fromKeyboardEvent(press('ArrowUp', { ctrlKey: true })), 'Control+Up')
  assert.equal(fromKeyboardEvent(press('Space', { metaKey: true, altKey: true })), 'Command+Alt+Space')

  // A modifier held on its own is a chord still being pressed, not an answer — otherwise
  // the recorder commits the moment you reach for ⌃.
  assert.equal(fromKeyboardEvent(press('ControlLeft', { ctrlKey: true })), null)
  // And a key with no modifier is refused, so the recorder keeps listening.
  assert.equal(fromKeyboardEvent(press('KeyR')), null)
})

test('a saved shortcut this build cannot register falls back, but "off" is kept', () => {
  const saved = sanitiseShortcuts({
    panel: 'nonsense from a hand-edited file',
    note: '',
    timer: 'cmd+alt+t',
    rewrite: 'Control+Alt+R',
    unknown: 'Command+Q',
  })

  // Junk would otherwise leave the action unreachable with no way to discover why.
  assert.equal(saved.panel, DEFAULT_SHORTCUTS.panel)
  // Empty means the user switched it off — re-arming it on the next launch would undo a
  // deliberate choice.
  assert.equal(saved.note, '')
  assert.equal(saved.timer, 'Command+Alt+T')
  assert.equal(saved.clips, DEFAULT_SHORTCUTS.clips)
  assert.ok(!('unknown' in saved), 'an id this app has no handler for was kept')
})

test('two shortcuts given the same keys are both named', () => {
  // Only one of them can ever fire, and a key that looks bound and does nothing is the
  // most confusing thing a shortcut can be.
  assert.deepEqual(
    clashingShortcuts({ panel: 'Control+Alt+R', rewrite: 'Control+Alt+R', note: 'Control+Alt+N' }).sort(),
    ['panel', 'rewrite'],
  )
  // Switched-off ones are not a clash with each other.
  assert.deepEqual(clashingShortcuts({ a: '', b: '' }), [])
})

test('every shortcut has a row in the Keys pane, and every row a shortcut', async () => {
  // A shortcut with no row cannot be rebound, and a row with no shortcut rebinds nothing.
  assert.deepEqual(
    SHORTCUT_MENU.map(([id]) => id).sort(),
    Object.keys(DEFAULT_SHORTCUTS).sort(),
  )
  assert.ok(SHORTCUT_MENU.every(([, label, description]) => label && description))

  // And each one is actually wired to something in app.js — an entry with no handler is
  // a row in a pane that does nothing at all.
  const app = await readFile(join(ROOT, 'src', 'main', 'app.js'), 'utf8')
  const handlers = app.slice(app.indexOf('const SHORTCUT_HANDLERS = {'), app.indexOf('let shortcuts ='))
  for (const [id] of SHORTCUT_MENU) {
    assert.match(handlers, new RegExp(`\\b${id}:`), `app.js has no handler for the ${id} shortcut`)
  }
})

test('the menus print the chord the user has bound, not the one that shipped', async () => {
  // A menu still advertising ⌃⌥N after a rebind is worse than one printing nothing.
  const menu = await readFile(join(ROOT, 'src', 'main', 'menu.js'), 'utf8')
  assert.doesNotMatch(menu, /accelerator: DEFAULT_SHORTCUTS\./)
  for (const [id] of SHORTCUT_MENU) {
    assert.match(menu, new RegExp(`chord\\(settings, '${id}'\\)`), `the menu never shows the ${id} shortcut`)
  }
})
