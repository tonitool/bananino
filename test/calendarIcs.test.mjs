import assert from 'node:assert/strict'
import test from 'node:test'
import { eventsFromIcs } from '../src/main/calendar/ics.js'

// ICS building blocks — folded lines and CRLFs are deliberate: that is what the wire
// format actually looks like.
const icsEvent = (lines) =>
  `BEGIN:VEVENT\r\n${lines.join('\r\n')}\r\nEND:VEVENT`

const feed = (...events) =>
  `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//test//EN\r\n${events.join('\r\n')}\r\nEND:VCALENDAR\r\n`

const NOW = Date.parse('2026-09-02T12:00:00Z') // a Wednesday
const HORIZON = 26 * 60 * 60 * 1000

test('a plain event with a Teams link in the location parses fully', () => {
  const events = eventsFromIcs(
    feed(
      icsEvent([
        'UID:abc123@clueone.de',
        'SUMMARY:Pitch call Clue One',
        'DTSTART:20260902T140000Z',
        'DTEND:20260902T150000Z',
        'LOCATION:https://teams.microsoft.com/l/meetup-join/19%3ameeting_abc',
        'DESCRIPTION:a call about the pitch\\, nothing more',
      ]),
    ),
    NOW,
    HORIZON,
  )

  assert.equal(events.length, 1)
  const [event] = events
  assert.ok(event.id.startsWith('abc123@clueone.de@')) // per-instance id
  assert.equal(event.title, 'Pitch call Clue One')
  assert.equal(event.startMs, Date.parse('2026-09-02T14:00:00Z'))
  assert.equal(event.endMs, Date.parse('2026-09-02T15:00:00Z'))
  assert.equal(event.joinUrl, 'https://teams.microsoft.com/l/meetup-join/19%3ameeting_abc')
  assert.equal(event.online, true)
})

test('TZID wall times land at the right instant (Berlin summer is UTC+2)', () => {
  const events = eventsFromIcs(
    feed(
      icsEvent([
        'UID:tz1',
        'SUMMARY:Lokaler Termin',
        'DTSTART;TZID=W. Europe Standard Time:20260902T140000',
        'DTEND;TZID=W. Europe Standard Time:20260902T143000',
      ]),
    ),
    NOW,
    HORIZON,
  )
  assert.equal(events[0].startMs, Date.parse('2026-09-02T12:00:00Z'))
})

test('folded lines unfold before parsing', () => {
  const events = eventsFromIcs(
    feed(
      icsEvent([
        'UID:fold1',
        // Folding is invisible: the CRLF plus one whitespace marker vanish mid-word.
        'SUMMARY:A meeting with a summary so long that Outlook folds it somewhere in the midd',
        ' le of the text',
        'DTSTART:20260902T130000Z',
        'DTEND:20260902T133000Z',
      ]),
    ),
    NOW,
    HORIZON,
  )
  assert.equal(
    events[0].title,
    'A meeting with a summary so long that Outlook folds it somewhere in the middle of the text',
  )
})

test('a weekly recurring standup expands into the horizon window', () => {
  const events = eventsFromIcs(
    feed(
      icsEvent([
        'UID:rrl1',
        'SUMMARY:Daily standup',
        'DTSTART:20260831T090000Z', // Monday
        'DTEND:20260831T091500Z',
        'RRULE:FREQ=DAILY;INTERVAL=1',
      ]),
    ),
    NOW,
    HORIZON,
  )
  // Between Wed 12:00 and Thu 14:00 UTC: Thursday 09:00 lands inside, Wednesday 09:00 is past.
  assert.deepEqual(events.map((e) => new Date(e.startMs).toISOString()), [
    '2026-09-03T09:00:00.000Z',
  ])
  // The id must stay unique per instance or reminders dedupe across days.
  assert.ok(events[0].id.startsWith('rrl1@'))
})

test('weekly BYDAY recurrence hits each named day', () => {
  const events = eventsFromIcs(
    feed(
      icsEvent([
        'UID:rrl2',
        'SUMMARY:Mon+Thu review',
        'DTSTART;TZID=UTC:20260831T100000', // a Monday
        'DTEND;TZID=UTC:20260831T103000',
        'RRULE:FREQ=WEEKLY;BYDAY=MO,TH',
      ]),
    ),
    NOW,
    HORIZON,
  )
  assert.deepEqual(
    events.map((e) => new Date(e.startMs).toISOString()),
    ['2026-09-03T10:00:00.000Z'], // only Thursday inside the horizon
  )
})

test('COUNT and UNTIL bound the expansion', () => {
  const counted = eventsFromIcs(
    feed(
      icsEvent([
        'UID:c1',
        'SUMMARY:Twice only',
        'DTSTART:20260901T090000Z',
        'DTEND:20260901T093000Z',
        'RRULE:FREQ=DAILY;COUNT=3',
      ]),
    ),
    NOW,
    HORIZON,
  )
  // Instances: Sep 1 (past), Sep 2 (past — ended before NOW), Sep 3 → only one upcoming.
  assert.equal(counted.length, 1)
  assert.equal(new Date(counted[0].startMs).toISOString(), '2026-09-03T09:00:00.000Z')

  const untiled = eventsFromIcs(
    feed(
      icsEvent([
        'UID:u1',
        'SUMMARY:Ends yesterday',
        'DTSTART:20260825T090000Z',
        'DTEND:20260825T093000Z',
        'RRULE:FREQ=DAILY;UNTIL=20260901T090000Z',
      ]),
    ),
    NOW,
    HORIZON,
  )
  assert.equal(untiled.length, 0)
})

test('EXDATE drops a single skipped occurrence', () => {
  const events = eventsFromIcs(
    feed(
      icsEvent([
        'UID:x1',
        'SUMMARY:Skipped Thursday',
        'DTSTART:20260902T090000Z',
        'DTEND:20260902T093000Z',
        'RRULE:FREQ=DAILY;INTERVAL=1',
        'EXDATE:20260903T090000Z',
      ]),
    ),
    NOW - 4 * 60 * 60 * 1000, // a bit earlier, so today's instance is visible too
    HORIZON,
  )
  assert.deepEqual(events.map((e) => new Date(e.startMs).toISOString()), [
    '2026-09-02T09:00:00.000Z',
    // '2026-09-03' is skipped by the EXDATE
  ])
})

test('all-day, past, cancelled, and malformed events drop out', () => {
  const events = eventsFromIcs(
    feed(
      icsEvent(['UID:d1', 'SUMMARY:All day', 'DTSTART;VALUE=DATE:20260902', 'DTEND;VALUE=DATE:20260903']),
      icsEvent(['UID:d2', 'SUMMARY:Done', 'DTSTART:20260901T090000Z', 'DTEND:20260901T100000Z']),
      icsEvent(['UID:d3', 'SUMMARY:Cancelled', 'DTSTART:20260902T160000Z', 'DTEND:20260902T170000Z', 'STATUS:CANCELLED']),
      icsEvent(['SUMMARY:No uid, no start']),
      'garbage that is not a block',
    ),
    NOW,
    HORIZON,
  )
  assert.deepEqual(events, [])
})

test('an ongoing meeting (started, not ended) stays in the list', () => {
  const events = eventsFromIcs(
    feed(
      icsEvent([
        'UID:live1',
        'SUMMARY:Happening right now',
        'DTSTART:20260902T113000Z',
        'DTEND:20260902T123000Z',
      ]),
    ),
    NOW,
    HORIZON,
  )
  assert.equal(events.length, 1)
  assert.equal(events[0].title, 'Happening right now')
})

test('a RECURRENCE-ID override replaces the master occurrence instead of doubling up', () => {
  const events = eventsFromIcs(
    feed(
      // The series: daily 09:00–09:30.
      icsEvent([
        'UID:series1',
        'SUMMARY:Wochenplanung',
        'DTSTART:20260901T090000Z',
        'DTEND:20260901T093000Z',
        'RRULE:FREQ=DAILY;COUNT=3',
      ]),
      // Thursday's instance was moved an hour later ("dieses Mal später").
      icsEvent([
        'UID:series1',
        'RECURRENCE-ID:20260903T090000Z',
        'SUMMARY:Wochenplanung (verschoben)',
        'DTSTART:20260903T100000Z',
        'DTEND:20260903T103000Z',
      ]),
    ),
    NOW,
    HORIZON * 2, // wide enough to catch all three days
  )

  assert.deepEqual(
    events.map((e) => `${new Date(e.startMs).toISOString()} ${e.title}`),
    ['2026-09-03T10:00:00.000Z Wochenplanung (verschoben)'],
  )
})

test('a same-time override (edited text) wins over the master copy', () => {
  const events = eventsFromIcs(
    feed(
      icsEvent([
        'UID:series2',
        'SUMMARY:Original title',
        'DTSTART:20260902T160000Z',
        'DTEND:20260902T163000Z',
        'RRULE:FREQ=DAILY;COUNT=2',
      ]),
      icsEvent([
        'UID:series2',
        'RECURRENCE-ID:20260902T160000Z',
        'SUMMARY:Retitled instance',
        'DTSTART:20260902T160000Z',
        'DTEND:20260902T163000Z',
      ]),
    ),
    NOW,
    HORIZON * 2,
  )

  const day1 = events.filter((e) => new Date(e.startMs).toISOString().startsWith('2026-09-02'))
  assert.equal(day1.length, 1)
  assert.equal(day1[0].title, 'Retitled instance')
})

test('garbage and empty feeds produce an empty list, never a crash', () => {
  assert.deepEqual(eventsFromIcs('', NOW, HORIZON), [])
  assert.deepEqual(eventsFromIcs('hello world', NOW, HORIZON), [])
  assert.deepEqual(eventsFromIcs(null, NOW, HORIZON), [])
})
