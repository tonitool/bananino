import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DANCES, DANCE_NAMES } from '../src/renderer/animation/dances.js'
import { SAMBA_CURVE } from '../src/renderer/animation/curves/samba.js'
import { IDENTITY } from '../src/renderer/animation/transform.js'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * The samba is the one dance that is data rather than a formula, so it is the one that can
 * be broken by a bad bake rather than by a bad edit. Whether it still *looks* like the
 * source clip is checked by `npm run bake-dance`, which reports its error against the
 * original; these are the properties the renderer relies on.
 */
test('the baked table is the shape it claims to be', () => {
  const { data, columns, frames, duration, fps, peaks } = SAMBA_CURVE

  assert.equal(data.length, frames * columns, 'the table is not a whole number of frames')
  assert.equal(peaks.length, columns)
  assert.equal(frames, Math.round(duration * fps), 'frames, duration and fps disagree')
  assert.ok(data.every(Number.isFinite), 'the table holds a value that is not a number')
  assert.ok(duration > 1, 'a dance this short would read as a twitch')
})

test('the samba loops seamlessly', () => {
  const { transform } = DANCES.samba
  const { duration } = SAMBA_CURVE

  for (const t of [0, 1.7, 9, duration - 0.001]) {
    const once = transform(t)
    const again = transform(t + duration)
    for (const field of Object.keys(IDENTITY)) {
      assert.ok(
        Math.abs(once[field] - again[field]) < 1e-9,
        `${field} differs by a lap: ${once[field]} then ${again[field]}`,
      )
    }
  }
})

/**
 * The amplitudes are the whole reason this is playable: the source performance travels
 * half a body height and turns right round, neither of which fits a character pinned in a
 * 260px corner of the screen. If a re-bake or a re-tune breaks these, the banana starts
 * leaving its own canvas or showing its back.
 */
test('the samba stays inside the budget the app can draw', () => {
  const { transform } = DANCES.samba
  const { duration } = SAMBA_CURVE
  const limits = {
    offsetX: 0.07,
    offsetY: 0.08,
    tiltX: 0.24,
    rollZ: 0.19,
    // Beyond ~0.35 rad the character starts turning its back on you, which the baked
    // curve avoids by taking its twist from the spine rather than the hips.
    turnY: 0.3,
  }

  const worst = {}
  for (let i = 0; i <= 4000; i += 1) {
    const pose = transform((i / 4000) * duration)

    for (const field of Object.keys(IDENTITY)) {
      assert.ok(Number.isFinite(pose[field]), `${field} is not finite`)
    }
    for (const [field, limit] of Object.entries(limits)) {
      worst[field] = Math.max(worst[field] ?? 0, Math.abs(pose[field]))
      assert.ok(Math.abs(pose[field]) <= limit, `${field} reached ${pose[field]}, over ${limit}`)
    }
    for (const field of ['scaleX', 'scaleY', 'scaleZ']) {
      assert.ok(pose[field] > 0.8 && pose[field] < 1.2, `${field} reached ${pose[field]}`)
    }
  }

  // A curve that never gets near its budget has been scaled into invisibility.
  for (const [field, limit] of Object.entries(limits)) {
    assert.ok(worst[field] > limit * 0.4, `${field} only reached ${worst[field]}, well under ${limit}`)
  }
})

test('the menu offers the samba', async () => {
  const constants = await readFile(join(ROOT, 'src', 'main', 'constants.js'), 'utf8')
  const block = constants.slice(
    constants.indexOf('DANCE_MENU = '),
    constants.indexOf('])', constants.indexOf('DANCE_MENU = ')),
  )
  const menu = [...block.matchAll(/\['([a-z0-9-]+)',/g)].map(([, name]) => name)

  // The main process cannot import the renderer's module, so the two lists are kept in
  // step by hand — a dance missing from the menu is a dance nobody can start.
  assert.deepEqual(menu, DANCE_NAMES)
})
