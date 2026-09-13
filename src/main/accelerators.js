import { DEFAULT_SHORTCUTS } from './constants.js'

/**
 * Keyboard shortcuts as text, in the one form Electron will take.
 *
 * Shared by both sides on purpose: the settings window records what you press and the main
 * process registers it, and the two disagreeing about what "⌃⌥R" means is exactly the bug
 * that leaves a shortcut showing in a pane and doing nothing on the desktop. So the
 * spelling, the checking and the prettifying all live here, with no electron in sight.
 *
 * A global shortcut is a strong claim: while the app runs, that combination belongs to it
 * everywhere on the system. Hence the rule below that one of ⌘ ⌃ ⌥ must be held — a bare
 * letter, or Shift and a letter, would eat the key in every text field on the Mac.
 */

/** Canonical order, so two spellings of the same chord compare equal. */
const MODIFIERS = Object.freeze(['Command', 'Control', 'Alt', 'Shift'])

/** What people (and other apps) call the same keys. */
const ALIASES = Object.freeze({
  cmd: 'Command',
  command: 'Command',
  meta: 'Command',
  super: 'Command',
  ctrl: 'Control',
  control: 'Control',
  alt: 'Alt',
  option: 'Alt',
  opt: 'Alt',
  shift: 'Shift',
  cmdorctrl: 'Command',
  commandorcontrol: 'Command',
})

/** How each modifier is drawn, in the order a Mac writes them. */
const SYMBOLS = Object.freeze({ Control: '⌃', Alt: '⌥', Shift: '⇧', Command: '⌘' })
const SYMBOL_ORDER = Object.freeze(['Control', 'Alt', 'Shift', 'Command'])

/** Keys worth allowing as the business end of a chord, beyond letters and digits. */
const NAMED_KEYS = Object.freeze([
  'Space', 'Tab', 'Backspace', 'Delete', 'Return', 'Escape',
  'Up', 'Down', 'Left', 'Right', 'Home', 'End', 'PageUp', 'PageDown',
  'Plus', 'Minus', 'Comma', 'Period', 'Slash', 'Backslash', 'Semicolon', 'Quote',
  'BracketLeft', 'BracketRight', 'Backquote',
])

/** The punctuation keys, as the symbol they print, for display. */
const KEY_SYMBOLS = Object.freeze({
  Space: '␣',
  Tab: '⇥',
  Backspace: '⌫',
  Delete: '⌦',
  Return: '↩',
  Escape: '⎋',
  Up: '↑',
  Down: '↓',
  Left: '←',
  Right: '→',
  Comma: ',',
  Period: '.',
  Slash: '/',
  Backslash: '\\',
  Semicolon: ';',
  Quote: "'",
  BracketLeft: '[',
  BracketRight: ']',
  Backquote: '`',
  Plus: '+',
  Minus: '-',
})

const isFunctionKey = (key) => /^F([1-9]|1\d|2[0-4])$/.test(key)

const isKey = (key) =>
  /^[A-Z0-9]$/.test(key) || isFunctionKey(key) || NAMED_KEYS.includes(key)

/**
 * A chord in canonical spelling, or null if it is not one this app will register.
 *
 * Null rather than a throw because every caller has something better to do with a bad
 * value than crash: the store falls back to the default, the recorder keeps listening.
 */
export const normaliseAccelerator = (value) => {
  const parts = String(value ?? '')
    .split('+')
    .map((part) => part.trim())
    .filter(Boolean)
  if (parts.length < 2) return null

  const modifiers = new Set()
  let key = null

  for (const part of parts) {
    const modifier = ALIASES[part.toLowerCase()]
    if (modifier) {
      modifiers.add(modifier)
      continue
    }
    // Two keys in one chord is not a chord; the first such part is the key, the rest junk.
    if (key !== null) return null
    const named = NAMED_KEYS.find((name) => name.toLowerCase() === part.toLowerCase())
    key = named ?? part.toUpperCase()
  }

  if (!key || !isKey(key)) return null
  // Shift alone would swallow an ordinary capital letter system-wide.
  if (![...modifiers].some((modifier) => modifier !== 'Shift')) return null

  return [...MODIFIERS.filter((modifier) => modifiers.has(modifier)), key].join('+')
}

export const isAccelerator = (value) => normaliseAccelerator(value) !== null

/** '⌃⌥R', the way the key caps read — for a menu, a pane, or a sentence. */
export const describeAccelerator = (value) => {
  const accelerator = normaliseAccelerator(value)
  if (!accelerator) return ''

  const parts = accelerator.split('+')
  const key = parts.pop()
  const held = SYMBOL_ORDER.filter((modifier) => parts.includes(modifier)).map((modifier) => SYMBOLS[modifier])
  return `${held.join('')}${KEY_SYMBOLS[key] ?? key}`
}

/**
 * What was just pressed, as an accelerator — the recorder's whole job.
 *
 * Read from `event.code`, never `event.key`: on a Mac ⌥R types "®", and a recorder that
 * believed `key` would register the shortcut for a character no keyboard can produce
 * without the same modifier. `code` is the physical key, which is what a global shortcut
 * matches on anyway.
 */
export const fromKeyboardEvent = (event) => {
  const code = String(event?.code ?? '')

  let key = null
  if (/^Key[A-Z]$/.test(code)) key = code.slice(3)
  else if (/^Digit\d$/.test(code)) key = code.slice(5)
  else if (isFunctionKey(code)) key = code
  else if (code === 'Space') key = 'Space'
  else if (code === 'Enter' || code === 'NumpadEnter') key = 'Return'
  else if (code.startsWith('Arrow')) key = code.slice(5)
  else if (NAMED_KEYS.includes(code)) key = code
  // Anything else — a modifier on its own, or a key with no name here — is not an answer
  // yet, so the recorder keeps waiting rather than committing to something odd.
  if (!key) return null

  const held = [
    event.metaKey && 'Command',
    event.ctrlKey && 'Control',
    event.altKey && 'Alt',
    event.shiftKey && 'Shift',
  ].filter(Boolean)

  return normaliseAccelerator([...held, key].join('+'))
}

/**
 * The saved set, made safe.
 *
 * An empty string is kept as an empty string: it means *deliberately off*, which is a
 * different thing from "unset" and must not be quietly re-armed with the default on the
 * next launch.
 */
export const sanitiseShortcuts = (raw, defaults = DEFAULT_SHORTCUTS) => {
  const shortcuts = {}
  for (const [id, fallback] of Object.entries(defaults)) {
    const value = raw?.[id]
    if (value === '') shortcuts[id] = ''
    else shortcuts[id] = normaliseAccelerator(value) ?? fallback
  }
  return shortcuts
}

/** Ids that have been given the same chord — the first one to register wins, so say so. */
export const clashingShortcuts = (shortcuts) => {
  const byAccelerator = new Map()
  for (const [id, accelerator] of Object.entries(shortcuts ?? {})) {
    if (!accelerator) continue
    byAccelerator.set(accelerator, [...(byAccelerator.get(accelerator) ?? []), id])
  }

  return [...byAccelerator.values()].filter((ids) => ids.length > 1).flat()
}
