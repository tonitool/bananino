import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile, stat } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CHARACTERS } from '../src/renderer/scene/characters.js'
import { DEFAULT_PLACEMENT, PRINT_AREAS, SHIRTS, shirtId, shirtIds } from '../src/renderer/scene/shirts.js'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * Same trap as the characters: the main process keeps its own list, because
 * src/main/constants.js must not import anything the packaged app does not ship. A shirt in
 * one list and not the other is either missing from the menu or thrown away by the store
 * the moment it is chosen.
 */
test('the menu and the renderer agree on which shirts exist', async () => {
  const constants = await readFile(join(ROOT, 'src', 'main', 'constants.js'), 'utf8')
  const at = constants.indexOf('SHIRT_MENU = ')
  const block = constants.slice(at, constants.indexOf('])', at))
  const menuIds = [...block.matchAll(/\['([a-z0-9-]+)',/g)].map(([, id]) => id)

  assert.ok(menuIds.length > 1, 'SHIRT_MENU was not parsed')
  assert.deepEqual(menuIds, shirtIds())
})

test('the labels in the menu are the labels in the registry', async () => {
  const constants = await readFile(join(ROOT, 'src', 'main', 'constants.js'), 'utf8')
  const at = constants.indexOf('SHIRT_MENU = ')
  const block = constants.slice(at, constants.indexOf('])', at))

  for (const [, id, label] of block.matchAll(/\['([a-z0-9-]+)', '([^']+)'\]/g)) {
    assert.equal(label, SHIRTS[id].label, `the menu calls "${id}" something else`)
  }
})

test('the shirt is a pair of ids and nothing more', () => {
  assert.ok(Object.hasOwn(SHIRTS, 'none'), 'there is no way to wear nothing')

  for (const [id, shirt] of Object.entries(SHIRTS)) {
    assert.equal(typeof shirt.label, 'string', `${id} has no label`)
    /*
     * Colour and artwork moved to the look, which dresses the cap at the same time. Left
     * here they would describe the same brand twice and be free to disagree about it.
     */
    assert.equal(shirt.color, undefined, `${id} still carries its own colour`)
    assert.equal(shirt.logo, undefined, `${id} still carries its own artwork`)
  }
})

test('the print areas sit on the chest, square on the fabric', () => {
  assert.ok(Object.hasOwn(PRINT_AREAS, DEFAULT_PLACEMENT), 'the default placement is not an area')

  for (const [name, area] of Object.entries(PRINT_AREAS)) {
    // u wraps the body with 0.5 at the middle of the chest and the seam up the back; a
    // design past a quarter turn either way is on a side the viewer never sees flat.
    assert.ok(area.u > 0.25 && area.u < 0.75, `${name} is printed around the side`)
    // v runs the whole shirt: the chest is the lower half, above it is yoke and collar.
    assert.ok(area.v > 0.1 && area.v < 0.5, `${name} is printed on the collar or the hem`)
    assert.ok(area.size > 0 && area.size < 0.25, `${name} reaches too far around the shirt`)
    assert.equal(area.width, undefined, `${name} still has a texture-space width`)
  }
})

test('an unknown shirt falls back to wearing none', () => {
  assert.equal(shirtId('acme'), 'none')
  assert.equal(shirtId(undefined), 'none')
  assert.equal(shirtId('polo'), 'polo')
})

/**
 * The polo is modelled for the banana, so only the banana declares a fit — and the garment
 * layer builds nothing without one, which is how the cat ends up wearing nothing rather
 * than a shirt stretched over a completely different animal.
 */
test('only the banana is fitted for a shirt, and its fit is a complete one', () => {
  const fitted = Object.entries(CHARACTERS).filter(([, character]) => character.shirt)
  assert.deepEqual(
    fitted.map(([id]) => id),
    ['banana'],
  )

  const { shirt } = CHARACTERS.banana
  for (const key of ['hemY', 'height', 'width', 'depth', 'z', 'lean']) {
    assert.ok(Number.isFinite(shirt[key]), `the banana's fit has no ${key}`)
  }
  // The collar has to stay clear of a face painted at eyeRatio, and the hem off the floor.
  assert.ok(shirt.hemY > 0, 'the hem is on the floor')
  assert.ok(
    shirt.hemY + shirt.height < CHARACTERS.banana.eyeRatio,
    'the shirt reaches over the face',
  )
  // Leaning forward would tip the collar into the face instead of back with the torso.
  assert.ok(shirt.lean <= 0, 'the shirt leans forwards')
})

/** The bake commits its output, unlike the characters — so it has to be in the tree. */
test('the baked polo is committed and small enough to be', async () => {
  const { size } = await stat(join(ROOT, 'assets', 'costumes', 'polo.glb'))
  assert.ok(size > 0, 'assets/costumes/polo.glb is empty')
  assert.ok(size < 512 * 1024, `the baked polo is ${size} bytes — the bake did not simplify`)
})

/** A new file in assets/ is no use to the app until the build copies it into build/. */
test('the build copies the polo into the renderer', async () => {
  const build = await readFile(join(ROOT, 'scripts', 'build-renderer.mjs'), 'utf8')
  assert.match(build, /'costumes', 'polo\.glb'/)
  assert.match(build, /mkdirSync\(join\(OUT_DIR, 'costumes'\)/)
})
