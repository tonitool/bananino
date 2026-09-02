import assert from 'node:assert/strict'
import test from 'node:test'
import { hasMoved, isInside } from '../src/main/geometry.js'

test('hasMoved reports movement for the very first sample', () => {
  // Regression: an unset previous point used to make every comparison NaN, so the
  // tracker returned early before recording the point and never emitted again.
  assert.equal(hasMoved(null, { x: 100, y: 100 }), true)
})

test('hasMoved ignores sub-pixel jitter', () => {
  assert.equal(hasMoved({ x: 10, y: 10 }, { x: 10.4, y: 10.2 }), false)
})

test('hasMoved reports movement past the epsilon on either axis', () => {
  assert.equal(hasMoved({ x: 10, y: 10 }, { x: 11, y: 10 }), true)
  assert.equal(hasMoved({ x: 10, y: 10 }, { x: 10, y: 9 }), true)
})

test('isInside treats the far edges as outside', () => {
  const bounds = { x: 0, y: 0, width: 100, height: 100 }
  assert.equal(isInside({ x: 0, y: 0 }, bounds), true)
  assert.equal(isInside({ x: 99, y: 99 }, bounds), true)
  assert.equal(isInside({ x: 100, y: 50 }, bounds), false)
  assert.equal(isInside({ x: 50, y: -1 }, bounds), false)
})
