import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'src')

const channelsIn = (source) => {
  const start = source.indexOf('IPC = ')
  const body = source.slice(start, source.indexOf('\n}', start))
  return Object.fromEntries(
    [...body.matchAll(/^\s{2}([a-zA-Z][a-zA-Z0-9]*):\s*'([^']+)'/gm)].map(([, name, channel]) => [
      name,
      channel,
    ]),
  )
}

/**
 * The preload is CommonJS and cannot import the main process's ESM constants, so it keeps
 * its own copy of the channel map. Adding a bridge method without adding its channel
 * leaves the name `undefined`, and Electron then rejects the send with an argument
 * conversion error at the moment the user clicks — which is exactly how the meeting
 * Record button shipped broken.
 */
test('the preload and the main process agree on every IPC channel they share', async () => {
  const [main, preload] = await Promise.all([
    readFile(join(SRC, 'main', 'constants.js'), 'utf8'),
    readFile(join(SRC, 'preload', 'index.cjs'), 'utf8'),
  ])

  const mainChannels = channelsIn(main)
  const preloadChannels = channelsIn(preload)

  assert.ok(Object.keys(preloadChannels).length > 10, 'the preload channel map was not parsed')

  const mismatched = Object.entries(preloadChannels)
    .filter(([name, channel]) => mainChannels[name] !== channel)
    .map(([name, channel]) => `${name}: preload has '${channel}', main has '${mainChannels[name]}'`)

  assert.deepEqual(mismatched, [])
})

test('every channel the preload sends on is actually named', async () => {
  const preload = await readFile(join(SRC, 'preload', 'index.cjs'), 'utf8')
  const channels = channelsIn(preload)

  const used = [...preload.matchAll(/IPC\.([a-zA-Z][a-zA-Z0-9]*)/g)].map(([, name]) => name)
  const undefinedNames = [...new Set(used.filter((name) => !(name in channels)))].sort()

  assert.deepEqual(undefinedNames, [])
})
