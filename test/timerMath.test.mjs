import assert from 'node:assert/strict'
import test from 'node:test'
import { MAX_TIMER_HOURS, nudgedStart } from '../src/main/timerMath.js'

const NOW = 1_760_000_000_000
const MINUTE = 60_000

test('adding minutes moves the start earlier', () => {
  const started = NOW - 4 * MINUTE
  assert.equal(nudgedStart(started, 5, NOW), started - 5 * MINUTE)
})

test('removing minutes moves the start later', () => {
  const started = NOW - 20 * MINUTE
  assert.equal(nudgedStart(started, -5, NOW), started + 5 * MINUTE)
})

test('the start can never move into the future', () => {
  // Otherwise the elapsed time goes negative and the logged duration is nonsense.
  const started = NOW - 2 * MINUTE
  assert.equal(nudgedStart(started, -60, NOW), NOW)
  assert.equal(nudgedStart(NOW, -1, NOW), NOW)
})

test('the start is capped so no absurd entry can be produced', () => {
  const cap = NOW - MAX_TIMER_HOURS * 60 * 60 * 1000
  assert.equal(nudgedStart(NOW - MINUTE, 60 * 24 * 7, NOW), cap)
})

test('nonsense leaves the timer untouched', () => {
  assert.equal(nudgedStart(NOW, Number.NaN, NOW), NOW)
  assert.equal(nudgedStart(Number.NaN, 5, NOW), Number.NaN)
})
