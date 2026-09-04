import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile, stat } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CAP_PRINT } from '../src/renderer/scene/cap.js'
import { DEFAULT_LOOK, LOOKS, lookId, lookIds, lookLogoFiles } from '../src/renderer/scene/looks.js'
import { PRINT_AREAS } from '../src/renderer/scene/shirts.js'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * Same trap as the characters and the shirt: the main process keeps its own list, because
 * src/main/constants.js must not import anything the packaged app does not ship. A look in
 * one list and not the other is either missing from the menu or thrown away by the store
 * the moment it is chosen.
 */
test('the menu and the renderer agree on the wardrobe', async () => {
  const constants = await readFile(join(ROOT, 'src', 'main', 'constants.js'), 'utf8')
  const at = constants.indexOf('LOOK_MENU = ')
  const block = constants.slice(at, constants.indexOf('])', at))
  const menuIds = [...block.matchAll(/\['([a-z0-9-]+)',/g)].map(([, id]) => id)

  assert.ok(menuIds.length > 1, 'LOOK_MENU was not parsed')
  assert.deepEqual(menuIds, lookIds())

  const [, fallback] = /DEFAULT_LOOK = '([a-z0-9-]+)'/.exec(constants)
  assert.equal(fallback, DEFAULT_LOOK)
})

test('the labels in the menu are the labels in the wardrobe', async () => {
  const constants = await readFile(join(ROOT, 'src', 'main', 'constants.js'), 'utf8')
  const at = constants.indexOf('LOOK_MENU = ')
  const block = constants.slice(at, constants.indexOf('])', at))

  for (const [, id, label] of block.matchAll(/\['([a-z0-9-]+)', '([^']+)'\]/g)) {
    assert.equal(label, LOOKS[id].label, `the menu calls "${id}" something else`)
  }
})

test('every look is a colour, and every pattern brings a second one', async () => {
  const patterns = await readFile(join(ROOT, 'src', 'renderer', 'scene', 'fabric.js'), 'utf8')
  const known = [...patterns.matchAll(/^  (?:\/\*\*[^]*?\*\/\n  )?([a-z]+): \(context/gm)].map(([, n]) => n)
  assert.ok(known.length >= 4, 'the pattern list was not parsed')

  for (const [id, look] of Object.entries(LOOKS)) {
    assert.equal(typeof look.label, 'string', `${id} has no label`)
    assert.match(look.color, /^#[0-9a-f]{6}$/i, `${id} has no cloth colour`)
    if (look.brim) assert.match(look.brim, /^#[0-9a-f]{6}$/i, `${id}'s brim is not a colour`)

    if (look.pattern === undefined) continue
    assert.ok(known.includes(look.pattern), `${id} weaves "${look.pattern}", which fabric.js has not got`)
    // A pattern draws its second colour and nothing else; without one it paints the cloth
    // white on white, which looks exactly like a plain look and is impossible to spot.
    assert.match(look.accent ?? '', /^#[0-9a-f]{6}$/i, `${id} has a pattern but no accent`)
  }
})

/**
 * A brand hands over one file and the promise is that it lands on the cap. That only holds
 * if the art it names is in the tree — missing art degrades to a plain look at runtime,
 * silently, which is the kind of thing nobody notices until a collaboration ships.
 */
test('every look that names artwork names artwork that exists', async () => {
  for (const file of lookLogoFiles()) {
    const found = await stat(join(ROOT, 'assets', 'shirt', file)).then(
      ({ size }) => size > 0,
      () => false,
    )
    assert.ok(found, `assets/shirt/${file} is named by a look but is not in the tree`)
  }
})

test('an unknown look falls back rather than leaving the cap unpainted', () => {
  assert.equal(lookId('chartreuse'), DEFAULT_LOOK)
  assert.equal(lookId(undefined), DEFAULT_LOOK)
  assert.equal(lookId('cobalt'), 'cobalt')
})

/**
 * The cap is the surface a logo actually goes on, so its print area has to stay on the
 * part of the crown that faces the camera. Rendering put the usable band between the peak
 * and the point where the dome turns away.
 */
test('the cap prints on the front of the crown, in a cap-shaped box', () => {
  assert.equal(CAP_PRINT.u, 0.5, 'the print has wandered off centre front')
  assert.ok(CAP_PRINT.v > 0.35 && CAP_PRINT.v < 0.7, 'the print is under the peak or over the apex')
  assert.ok(CAP_PRINT.aspect > 1.5, 'a square print on a crown this short comes out tiny')

  // The box must fit inside the crown once the stretch is undone, or it wraps the whole
  // dome and foreshortens into a smear — which is exactly what the first attempt did.
  const stretch = (2 * Math.PI) / 0.98
  const span = (CAP_PRINT.size * stretch) / CAP_PRINT.aspect
  assert.ok(CAP_PRINT.v + span / 2 <= 1, 'the print runs off the top of the crown')
  assert.ok(CAP_PRINT.v - span / 2 >= 0, 'the print runs off the bottom of the crown')
})

test('the cap and the shirt describe their print areas the same way', () => {
  for (const area of [CAP_PRINT, ...Object.values(PRINT_AREAS)]) {
    assert.ok(area.u > 0.25 && area.u < 0.75, 'a print has wandered round the side')
    assert.ok(area.size > 0 && area.size < 0.25, 'a print reaches too far around')
  }
})
