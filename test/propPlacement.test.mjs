import assert from 'node:assert/strict'
import test from 'node:test'
import { CAMERA, VISIBLE_HALF_EXTENT, standBeside } from '../src/renderer/scene/frame.js'

/*
 * The radio and the clock stand beside the character at a multiple of its measured width.
 * That worked for exactly as long as the banana was the only character: the cat is 64%
 * wider, which put the radio 15px outside the canvas and left the clock with three pixels
 * to spare. These are the guards for that arithmetic — the props' own widths, mirrored
 * from musicScene.js and clockScene.js, and the two characters' measured half-widths.
 */
const RADIO = { reach: 2.4, halfExtent: (0.4485 / 2) * Math.cos(0.35) + (0.1176 / 2) * Math.sin(0.35) }
const CLOCK = { reach: 2.15, halfExtent: (0.16 + 0.016) * Math.cos(0.3) + (0.055 / 2 + 0.028) * Math.sin(0.3) }

const SIDE_X = { banana: 0.21, cat: 0.3447 }

/*
 * The worst case a placed prop has to survive: the pivot's arrival overshoot (about 1.1),
 * and the perspective magnification of standing in front of the character (about 1.05,
 * since the projection scales by distance / (distance - z)).
 */
const OVERSHOOT = 1.1 * 1.05

test('the visible extent is the camera\'s, not a number somebody typed', () => {
  // Independent restatement of the same geometry: half the frame is the distance to what
  // the camera looks at, times the tangent of half its field of view.
  const distance = Math.hypot(
    CAMERA.position[0] - CAMERA.lookAt[0],
    CAMERA.position[1] - CAMERA.lookAt[1],
    CAMERA.position[2] - CAMERA.lookAt[2],
  )
  assert.ok(Math.abs(VISIBLE_HALF_EXTENT - distance * Math.tan((14 * Math.PI) / 180)) < 1e-12)
  assert.ok(Math.abs(VISIBLE_HALF_EXTENT - 0.9479) < 0.0001, `got ${VISIBLE_HALF_EXTENT}`)

  // And the floor the same numbers imply is the one the stylesheet positions props by.
  const floor = (VISIBLE_HALF_EXTENT - CAMERA.lookAt[1]) / (2 * VISIBLE_HALF_EXTENT)
  assert.ok(Math.abs(floor - 0.215) < 0.001, `--floor in tokens.css says 0.215, this says ${floor}`)
})

test('the banana keeps the props exactly where they were', () => {
  // The clamp is a fix, not a redesign: the character it was tuned around must not move.
  assert.ok(Math.abs(standBeside({ sideX: SIDE_X.banana, ...RADIO }) - 0.504) < 0.0005)
  assert.ok(Math.abs(standBeside({ sideX: SIDE_X.banana, ...CLOCK }) - 0.4515) < 0.0005)
})

test('a wider character pulls the props in rather than off the edge', () => {
  for (const [name, prop] of [['radio', RADIO], ['clock', CLOCK]]) {
    const banana = standBeside({ sideX: SIDE_X.banana, ...prop })
    const cat = standBeside({ sideX: SIDE_X.cat, ...prop })

    // Unclamped, the cat asks to stand further out than the frame can hold. The radio was
    // over the edge outright; the clock had 0.022 of static headroom and lost it to the
    // overshoot, which is why both are clamped and neither is treated as the safe one.
    const asked = SIDE_X.cat * prop.reach + prop.halfExtent
    assert.ok(asked * OVERSHOOT > VISIBLE_HALF_EXTENT, `${name} was never clipped, so this test is stale`)

    assert.ok(cat > banana, `${name} should still stand further out for a wider body`)
    assert.ok(cat + prop.halfExtent < VISIBLE_HALF_EXTENT, `${name} still leaves the frame`)
  }
})

test('every plausible character keeps both props on screen, overshoot included', () => {
  for (let sideX = 0.05; sideX <= 0.7; sideX += 0.005) {
    for (const [name, prop] of [['radio', RADIO], ['clock', CLOCK]]) {
      const offset = standBeside({ sideX, ...prop })
      assert.ok(offset > 0, `${name} placed at or behind the character at sideX ${sideX}`)

      // The props hang off the pivot, so its scale multiplies both their distance out and
      // their own size, and perspective adds a little more — the reveal is the worst case,
      // not the resting pose.
      const outer = (offset + prop.halfExtent) * OVERSHOOT
      assert.ok(
        outer <= VISIBLE_HALF_EXTENT,
        `${name} reaches ${outer.toFixed(4)} at sideX ${sideX.toFixed(3)}, past ${VISIBLE_HALF_EXTENT.toFixed(4)}`,
      )
    }
  }
})
