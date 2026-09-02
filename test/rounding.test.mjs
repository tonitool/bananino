import assert from 'node:assert/strict'
import test from 'node:test'
import { roundMinutesUp } from '../src/main/moco/rounding.js'

test('rounding is off unless a step is chosen', () => {
  assert.equal(roundMinutesUp(10, 0), 10)
  assert.equal(roundMinutesUp(10, undefined), 10)
  assert.equal(roundMinutesUp(10, 7), 10, 'an unsupported step is ignored, not guessed')
})

test('quarter-hour rounding always goes up', () => {
  // Up only: a client is never billed for less than was worked, and the user is never
  // surprised by time disappearing.
  assert.equal(roundMinutesUp(1, 15), 15)
  assert.equal(roundMinutesUp(10, 15), 15)
  assert.equal(roundMinutesUp(15, 15), 15)
  assert.equal(roundMinutesUp(16, 15), 30)
  assert.equal(roundMinutesUp(90, 15), 90)
})

test('five-minute rounding', () => {
  assert.equal(roundMinutesUp(1, 5), 5)
  assert.equal(roundMinutesUp(11, 5), 15)
  assert.equal(roundMinutesUp(10, 5), 10)
})

test('nothing to round stays untouched', () => {
  assert.equal(roundMinutesUp(0, 15), 0)
  assert.equal(roundMinutesUp(-5, 15), -5)
})
