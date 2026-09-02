import assert from 'node:assert/strict'
import test from 'node:test'
import { isNewerVersion, parseRepository } from '../src/main/update/version.js'

test('a later release is newer', () => {
  assert.equal(isNewerVersion('1.0.0', '1.0.1'), true)
  assert.equal(isNewerVersion('1.0.0', '1.1.0'), true)
  assert.equal(isNewerVersion('1.9.9', '2.0.0'), true)
  assert.equal(isNewerVersion('1.0.0', 'v1.0.1'), true, 'tags usually carry a v')
})

test('the same or an older release is not newer', () => {
  assert.equal(isNewerVersion('1.0.0', '1.0.0'), false)
  assert.equal(isNewerVersion('2.0.0', '1.9.9'), false)
  assert.equal(isNewerVersion('1.10.0', '1.9.0'), false, '10 is above 9, not below it')
})

test('an unparseable version never prompts an update', () => {
  // A malformed tag must not be able to nag every user of the app.
  for (const bad of ['', 'latest', 'nightly', undefined, null, {}]) {
    assert.equal(isNewerVersion('1.0.0', bad), false, JSON.stringify(bad))
    assert.equal(isNewerVersion(bad, '2.0.0'), false, JSON.stringify(bad))
  }
})

test('the repository is read from the usual URL shapes', () => {
  assert.deepEqual(parseRepository('https://github.com/acme/lualala'), { owner: 'acme', repo: 'lualala' })
  assert.deepEqual(parseRepository('https://github.com/acme/lualala.git'), { owner: 'acme', repo: 'lualala' })
  assert.deepEqual(parseRepository('git@github.com:acme/lualala.git'), { owner: 'acme', repo: 'lualala' })
})

test('an unset placeholder disables checking rather than calling a fake repo', () => {
  assert.equal(parseRepository('https://github.com/OWNER/REPO'), null)
  assert.equal(parseRepository('https://example.com/acme/lualala'), null)
  assert.equal(parseRepository(''), null)
})
