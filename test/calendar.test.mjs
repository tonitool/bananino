import assert from 'node:assert/strict'
import test from 'node:test'
import { buildRequest } from '../src/main/calendar/client.js'
import {
  buildCreateArgs,
  dueReminders,
  normaliseEvent,
  parseAttendees,
  parseWhen,
  pickJoinUrl,
  pickSlug,
  upcomingFrom,
} from '../src/main/calendar/events.js'

// Arrange helper: a Graph-shaped event with the fields the actions actually return.
const makeEvent = (overrides = {}) => ({
  id: `evt-${Math.random()}`,
  subject: 'Weekly sync',
  start: { dateTime: '2026-09-02T14:00:00.000Z', timeZone: 'Europe/Berlin' },
  end: { dateTime: '2026-09-02T14:30:00.000Z', timeZone: 'Europe/Berlin' },
  ...overrides,
})

test('the request builder pins the base URL, key header, and body', () => {
  // Arrange / Act
  const { url, init } = buildRequest({
    apiKey: 'cmp_test_key',
    path: '/tools/execute/OUTLOOK_CREATE_ME_EVENT',
    method: 'POST',
    body: { user_id: 'bananino', arguments: { subject: 'Hi' } },
  })

  // Assert
  assert.equal(url, 'https://backend.composio.dev/api/v3/tools/execute/OUTLOOK_CREATE_ME_EVENT')
  assert.equal(init.headers['x-api-key'], 'cmp_test_key')
  assert.equal(init.method, 'POST')
  assert.deepEqual(JSON.parse(init.body), { user_id: 'bananino', arguments: { subject: 'Hi' } })
})

test('GET requests carry no body', () => {
  const { init } = buildRequest({ apiKey: 'k', path: '/tools?toolkit_slug=OUTLOOK' })
  assert.equal(init.method, 'GET')
  assert.equal(init.body, undefined)
})

test('join URL comes from the structured fields before the body text', () => {
  assert.equal(
    pickJoinUrl(makeEvent({ onlineMeeting: { joinUrl: 'https://teams.microsoft.com/l/meetup/abc' } })),
    'https://teams.microsoft.com/l/meetup/abc',
  )
  assert.equal(
    pickJoinUrl(makeEvent({ onlineMeetingUrl: 'https://teams.live.com/meet/xyz' })),
    'https://teams.live.com/meet/xyz',
  )
  assert.equal(
    pickJoinUrl(makeEvent({ body: { content: 'Join: <a href="https://teams.microsoft.com/l/meetup/abc?x=1">link</a>' } })),
    'https://teams.microsoft.com/l/meetup/abc?x=1',
  )
  assert.equal(pickJoinUrl(makeEvent()), null)
  assert.equal(pickJoinUrl(makeEvent({ body: { content: 'meet at the office' } })), null)
})

test('normaliseEvent maps a Graph event into the panel shape', () => {
  const event = normaliseEvent(
    makeEvent({ location: { displayName: 'Room 2' }, webLink: 'https://outlook.office.com/xyz' }),
  )
  assert.equal(event.title, 'Weekly sync')
  assert.equal(event.startMs, Date.parse('2026-09-02T14:00:00.000Z'))
  assert.equal(event.endMs, Date.parse('2026-09-02T14:30:00.000Z'))
  assert.equal(event.location, 'Room 2')
  assert.equal(event.online, false)
  assert.equal(event.allDay, false)
})

test('an untitled event still lists, an undated one must not', () => {
  assert.equal(normaliseEvent(makeEvent({ subject: '' })).title, '(no title)')
  assert.equal(normaliseEvent(makeEvent({ subject: null })).title, '(no title)')
  assert.equal(normaliseEvent(makeEvent({ start: null })), null)
  assert.equal(normaliseEvent({}), null)
})

test('upcomingFrom drops cancelled, declined, past, and all-day events, and sorts', () => {
  const now = Date.parse('2026-09-02T12:00:00.000Z')
  const horizonMs = 26 * 60 * 60 * 1000

  const good = makeEvent({ id: 'good' })
  const earlier = makeEvent({ id: 'earlier', start: { dateTime: '2026-09-02T12:30:00.000Z' } })
  const cancelled = makeEvent({ id: 'cancelled', isCancelled: true })
  const declined = makeEvent({ id: 'declined', responseStatus: { response: 'declined' } })
  const past = makeEvent({ id: 'past', start: { dateTime: '2026-09-02T10:00:00.000Z' }, end: { dateTime: '2026-09-02T10:30:00.000Z' } })
  const allDay = makeEvent({ id: 'allday', start: { date: '2026-09-02' }, end: { date: '2026-09-03' } })
  const far = makeEvent({ id: 'far', start: { dateTime: '2026-09-05T14:00:00.000Z' }, end: { dateTime: '2026-09-05T15:00:00.000Z' } })

  const upcoming = upcomingFrom({ data: { value: [far, good, cancelled, declined, past, allDay, earlier] } }, now, horizonMs)

  assert.deepEqual(upcoming.map((e) => e.id), ['earlier', 'good'])
})

test('upcomingFrom survives empty and odd payloads without throwing', () => {
  const now = Date.now()
  assert.deepEqual(upcomingFrom(null, now, 1000), [])
  assert.deepEqual(upcomingFrom({}, now, 1000), [])
  assert.deepEqual(upcomingFrom({ data: 'nope' }, now, 1000), [])
  assert.deepEqual(upcomingFrom([null, 42], now, 1000), [])
})

test('dueReminders fires soon once inside the window and now once after start', () => {
  const startMs = Date.parse('2026-09-02T14:00:00.000Z')
  const event = { ...normaliseEvent(makeEvent()), startMs }
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

test('pickSlug prefers the calendar view and tolerates missing candidates', () => {
  const candidates = ['OUTLOOK_LIST_CALENDAR_VIEW_EVENTS', 'OUTLOOK_LIST_EVENTS']
  assert.equal(pickSlug(['X', 'OUTLOOK_LIST_EVENTS'], candidates), 'OUTLOOK_LIST_EVENTS')
  assert.equal(pickSlug(['OUTLOOK_LIST_CALENDAR_VIEW_EVENTS'], candidates), 'OUTLOOK_LIST_CALENDAR_VIEW_EVENTS')
  assert.equal(pickSlug([], candidates), null)
  assert.equal(pickSlug(['SOMETHING_ELSE'], candidates), null)
})

test('buildCreateArgs adds a Teams meeting only when asked, times as zone wall clocks', () => {
  // 09:15 Berlin in September is 07:15 UTC.
  const startMs = Date.parse('2026-09-03T07:15:00.000Z')
  const plain = buildCreateArgs({ title: 'Focus', startMs, minutes: 30, timeZone: 'Europe/Berlin', online: false, attendees: [] })
  assert.equal(plain.subject, 'Focus')
  assert.equal(plain.is_online_meeting, false)
  assert.equal(plain.online_meeting_provider, undefined)
  // Wall-time strings: Graph reads dateTime in the named zone, so '09:15' must appear raw.
  assert.equal(plain.start_date_time, '2026-09-03T09:15:00')
  assert.equal(plain.end_date_time, '2026-09-03T09:45:00')
  assert.deepEqual(plain.start, { dateTime: '2026-09-03T09:15:00', timeZone: 'Europe/Berlin' })

  const teams = buildCreateArgs({ title: 'Daily', startMs, minutes: 15, timeZone: 'Europe/Berlin', online: true, attendees: ['a@b.co'] })
  assert.equal(teams.is_online_meeting, true)
  assert.equal(teams.online_meeting_provider, 'teamsForBusiness')
  assert.deepEqual(teams.attendees, [{ emailAddress: { address: 'a@b.co' } }])
})

test('parseWhen reads naive Graph times in the event zone, not the Mac zone', () => {
  // Berlin in September is UTC+2: a 14:00 Berlin meeting starts at 12:00 UTC.
  assert.equal(parseWhen('2026-09-02T14:00:00.0000000', 'Europe/Berlin'), Date.parse('2026-09-02T12:00:00Z'))
  // Windows-zone names, as Graph actually sends them.
  assert.equal(parseWhen('2026-09-02T14:00:00', 'W. Europe Standard Time'), Date.parse('2026-09-02T12:00:00Z'))
  // Winter: +1.
  assert.equal(parseWhen('2026-01-15T14:00:00', 'Europe/Berlin'), Date.parse('2026-01-15T13:00:00Z'))
  // Explicit marks pass straight through.
  assert.equal(parseWhen('2026-09-02T14:00:00Z', 'Europe/Berlin'), Date.parse('2026-09-02T14:00:00Z'))
  assert.equal(parseWhen('2026-09-02T14:00:00+02:00', 'Europe/Berlin'), Date.parse('2026-09-02T12:00:00Z'))
  // No zone information at all falls back to UTC, deterministically — never to the
  // machine's local zone, which a shared mailbox does not share.
  assert.equal(parseWhen('2026-09-02T14:00:00', undefined), Date.parse('2026-09-02T14:00:00Z'))
  assert.equal(parseWhen('2026-09-02T14:00:00', 'UTC'), Date.parse('2026-09-02T14:00:00Z'))
  // An unknown zone name must degrade to the same UTC guess, not crash.
  assert.equal(parseWhen('2026-09-02T14:00:00', 'No/Such_Zone'), Date.parse('2026-09-02T14:00:00Z'))
  assert.ok(Number.isNaN(parseWhen('not a date', 'Europe/Berlin')))
  assert.ok(Number.isNaN(parseWhen(undefined, 'Europe/Berlin')))
})

test('parseAttendees keeps valid emails and drops the rest', () => {
  assert.deepEqual(parseAttendees('a@b.co, nobody@c.de; not-an-email x@y'), ['a@b.co', 'nobody@c.de'])
  assert.deepEqual(parseAttendees(''), [])
  assert.deepEqual(parseAttendees(undefined), [])
})
