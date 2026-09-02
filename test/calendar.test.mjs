import assert from 'node:assert/strict'
import test from 'node:test'
import { dueReminders, parseWhen, pickUrlFromText } from '../src/main/calendar/events.js'

test('join links surface from free text, other links do not', () => {
  assert.equal(
    pickUrlFromText('Join: https://teams.microsoft.com/l/meetup-join/19%3ameeting_abc now'),
    'https://teams.microsoft.com/l/meetup-join/19%3ameeting_abc',
  )
  assert.equal(pickUrlFromText('https://meet.google.com/abc-defg-hij'), 'https://meet.google.com/abc-defg-hij')
  assert.equal(pickUrlFromText('https://clueone.zoom.us/j/123'), 'https://clueone.zoom.us/j/123')
  assert.equal(pickUrlFromText('https://evil-teams.example.com/x'), null)
  assert.equal(pickUrlFromText(null), null)
  assert.equal(pickUrlFromText('meet at the office'), null)
})

test('parseWhen reads naive feed times in the event zone, not the Mac zone', () => {
  // Berlin in September is UTC+2: a 14:00 Berlin meeting starts at 12:00 UTC.
  assert.equal(parseWhen('2026-09-02T14:00:00.0000000', 'Europe/Berlin'), Date.parse('2026-09-02T12:00:00Z'))
  // Windows-zone names, as Exchange sends them.
  assert.equal(parseWhen('2026-09-02T14:00:00', 'W. Europe Standard Time'), Date.parse('2026-09-02T12:00:00Z'))
  // Winter: +1.
  assert.equal(parseWhen('2026-01-15T14:00:00', 'Europe/Berlin'), Date.parse('2026-01-15T13:00:00Z'))
  // Explicit marks pass straight through.
  assert.equal(parseWhen('2026-09-02T14:00:00Z', 'Europe/Berlin'), Date.parse('2026-09-02T14:00:00Z'))
  assert.equal(parseWhen('2026-09-02T14:00:00+02:00', 'Europe/Berlin'), Date.parse('2026-09-02T12:00:00Z'))
  // No zone information at all falls back to UTC, deterministically — never to the
  // machine's local zone, which a feed from another machine does not share.
  assert.equal(parseWhen('2026-09-02T14:00:00', undefined), Date.parse('2026-09-02T14:00:00Z'))
  assert.equal(parseWhen('2026-09-02T14:00:00', 'UTC'), Date.parse('2026-09-02T14:00:00Z'))
  // An unknown zone name must degrade to the same UTC guess, not crash.
  assert.equal(parseWhen('2026-09-02T14:00:00', 'No/Such_Zone'), Date.parse('2026-09-02T14:00:00Z'))
  assert.ok(Number.isNaN(parseWhen('not a date', 'Europe/Berlin')))
  assert.ok(Number.isNaN(parseWhen(undefined, 'Europe/Berlin')))
})

test('dueReminders fires soon once inside the window and now once after start', () => {
  const startMs = Date.parse('2026-09-02T14:00:00.000Z')
  const event = { id: 'evt1', title: 'Weekly sync', startMs, endMs: startMs + 30 * 60_000 }
  const reminded = new Set()

  // Too early: nothing.
  assert.deepEqual(dueReminders([event], startMs - 10 * 60_000, reminded, 5, 10), [])

  // Inside the 5-minute window: 'soon' fires — and only once.
  let due = dueReminders([event], startMs - 3 * 60_000, reminded, 5, 10)
  assert.equal(due.length, 1)
  assert.equal(due[0].kind, 'soon')
  reminded.add(due[0].key)
  assert.deepEqual(dueReminders([event], startMs - 2 * 60_000, reminded, 5, 10), [])

  // At start: 'now' fires, still within grace a little later, then stops.
  due = dueReminders([event], startMs + 30_000, reminded, 5, 10)
  assert.equal(due.length, 1)
  assert.equal(due[0].kind, 'now')
  reminded.add(due[0].key)
  assert.deepEqual(dueReminders([event], startMs + 60_000, reminded, 5, 10), [])
  assert.deepEqual(dueReminders([event], startMs + 11 * 60_000, reminded, 5, 10), [])
})
