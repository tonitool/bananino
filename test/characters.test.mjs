import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile, stat } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CHARACTERS, DEFAULT_CHARACTER, characterIds } from '../src/renderer/scene/characters.js'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * The main process cannot import the renderer's registry — src/main/constants.js has to
 * stay free of anything the packaged app does not ship — so it keeps its own list of ids
 * for the menu and for validating the stored setting. A character added to one list and
 * not the other is either missing from the menu or, worse, thrown away by the store the
 * moment it is chosen.
 */
test('the menu and the renderer agree on which characters exist', async () => {
  const constants = await readFile(join(ROOT, 'src', 'main', 'constants.js'), 'utf8')
  const block = constants.slice(
    constants.indexOf('CHARACTER_MENU = '),
    constants.indexOf('])', constants.indexOf('CHARACTER_MENU = ')),
  )
  const menuIds = [...block.matchAll(/\['([a-z0-9-]+)',/g)].map(([, id]) => id)

  assert.ok(menuIds.length > 1, 'CHARACTER_MENU was not parsed')
  assert.deepEqual(menuIds, characterIds())

  const [, defaultId] = /DEFAULT_CHARACTER = '([a-z0-9-]+)'/.exec(constants)
  assert.equal(defaultId, DEFAULT_CHARACTER)
})

test('every character declares what the renderer needs and has a source model', async () => {
  for (const [id, character] of Object.entries(CHARACTERS)) {
    assert.equal(typeof character.label, 'string', `${id} has no label`)
    assert.ok(character.label.length > 0, `${id} has an empty label`)
    assert.equal(typeof character.blurb, 'string', `${id} has no blurb`)
    assert.ok(Number.isFinite(character.yaw), `${id} has no yaw`)
    // Anything outside this is not a face: it is the feet or the top of the head.
    assert.ok(
      character.eyeRatio > 0.2 && character.eyeRatio < 0.95,
      `${id} has an implausible eyeRatio`,
    )

    // The optimised .glb is generated, so only the source is expected to be here.
    const source = join(ROOT, 'assets', 'characters', `${id}.source.glb`)
    const { size } = await stat(source).catch(() => ({ size: 0 }))
    assert.ok(size > 0, `${id} has no model at assets/characters/${id}.source.glb`)
  }
})

test('an unknown character falls back rather than loading nothing', async () => {
  const { characterId, characterModelUrl, isCharacterId } = await import(
    '../src/renderer/scene/characters.js'
  )

  assert.equal(isCharacterId('cat'), true)
  assert.equal(isCharacterId('dinosaur'), false)
  assert.equal(characterId('dinosaur'), DEFAULT_CHARACTER)
  assert.equal(characterId(null), DEFAULT_CHARACTER)
  assert.equal(characterModelUrl('cat'), './characters/cat.glb')
  assert.equal(characterModelUrl('dinosaur'), `./characters/${DEFAULT_CHARACTER}.glb`)
})
