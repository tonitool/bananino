import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile, stat } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CHARACTERS } from '../src/renderer/scene/characters.js'
import {
  DEFAULT_PLACEMENT,
  PRINT_AREAS,
  SHIRTS,
  shirtId,
  shirtIds,
  shirtLogoFiles,
} from '../src/renderer/scene/shirts.js'

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

test('"none" is bare and every other shirt is a colour and a placement that exists', () => {
  assert.ok(Object.hasOwn(SHIRTS, 'none'), 'there is no way to wear nothing')
  assert.equal(SHIRTS.none.color, undefined, '"none" must not describe fabric')

  for (const [id, shirt] of Object.entries(SHIRTS)) {
    assert.equal(typeof shirt.label, 'string', `${id} has no label`)
    if (id === 'none') continue

    assert.match(shirt.color, /^#[0-9a-f]{6}$/i, `${id} has no fabric colour`)
    if (shirt.placement !== undefined) {
      assert.ok(
        Object.hasOwn(PRINT_AREAS, shirt.placement),
        `${id} is printed in "${shirt.placement}", which is not a print area`,
      )
    }
    // A logo without artwork paints nothing; artwork without a logo never gets fetched.
    if (shirt.logo !== undefined) assert.match(shirt.logo, /\.png$/, `${id}'s logo is not a PNG`)
  }
})

/**
 * A brand hands over one file, and the promise is that it lands on the chest without
 * anybody editing 3D code. That only holds if the art it names is actually in the tree —
 * missing art degrades to a plain shirt at runtime, silently, which is exactly the kind of
 * thing nobody notices until a collaboration ships.
 */
test('every collaboration names artwork that exists', async () => {
  for (const file of shirtLogoFiles()) {
    const path = join(ROOT, 'assets', 'shirt', file)
    const found = await stat(path).then(
      ({ size }) => size > 0,
      () => false,
    )
    assert.ok(found, `assets/shirt/${file} is named by a shirt but is not in the tree`)
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
  assert.equal(shirtId('blank'), 'blank')
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
