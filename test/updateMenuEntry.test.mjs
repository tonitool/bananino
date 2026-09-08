import assert from 'node:assert/strict'
import test from 'node:test'
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
