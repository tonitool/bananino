import assert from 'node:assert/strict'
import test from 'node:test'
import { describeMinutes, parseDuration } from '../src/main/storage/duration.js'

test('a bare number is minutes', () => {
  assert.equal(parseDuration('90'), 90)
  assert.equal(parseDuration('  45 '), 45)
  assert.equal(parseDuration('1'), 1)
})

test('minutes can be spelled out', () => {
  for (const text of ['90m', '90 m', '90min', '90 mins', '90 minutes']) {
    assert.equal(parseDuration(text), 90, text)
  }
})

test('hours, with a decimal point or a German comma', () => {
  assert.equal(parseDuration('2h'), 120)
  assert.equal(parseDuration('1.5h'), 90)
  assert.equal(parseDuration('1,5h'), 90, 'a German decimal comma is the local convention')
  assert.equal(parseDuration('0.25 hours'), 15)
})

test('hours and minutes together', () => {
  assert.equal(parseDuration('1h30'), 90)
  assert.equal(parseDuration('1h 30m'), 90)
  assert.equal(parseDuration('1:30'), 90)
  assert.equal(parseDuration('0:45'), 45)
  assert.equal(parseDuration('8:00'), 480)
})

test('nonsense returns null rather than a guess', () => {
  // A misread duration becomes a wrong billable record, so ambiguity must not be resolved.
  for (const text of ['', '   ', 'abc', 'an hour', '1:75', '1h 90m', '-30', '0', undefined, null]) {
    assert.equal(parseDuration(text), null, JSON.stringify(text))
  }
})

test('a day is the ceiling', () => {
  assert.equal(parseDuration('24h'), 1440)
  assert.equal(parseDuration('25h'), null)
  assert.equal(parseDuration('2000'), null)
})

test('minutes are described back the way people read them', () => {
  assert.equal(describeMinutes(90), '1h 30m')
  assert.equal(describeMinutes(60), '1h')
  assert.equal(describeMinutes(45), '45m')
  assert.equal(describeMinutes(1440), '24h')
})
