import assert from 'node:assert/strict'
import test from 'node:test'
import { createCalendarSync } from '../src/main/calendar/sync.js'

const ICS_TEMPLATE = (uid, startMs, minutes = 30) => `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:${uid}
SUMMARY:Daily standup
DTSTART:${new Date(startMs).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')}
DTEND:${new Date(startMs + minutes * 60_000).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')}
LOCATION:https://teams.microsoft.com/l/meetup-join/xyz
END:VEVENT
END:VCALENDAR`

/**
 * The sync module with the Keychain and the network replaced by fakes, so the connect /
 * poll / remind / disconnect cycle can be tested the way the rest of the pure code is.
 */
const makeHarness = ({ icsText = null, fetchFails = false } = {}) => {
  let settings = { calendarFeed: false }
  let storedUrl = null
  let shouldFail = fetchFails
  const reminders = []
  const fetches = []

  const feed = {
    normaliseFeedUrl: (value) => {
      const trimmed = String(value ?? '').trim()
      if (!trimmed.startsWith('https://')) throw new Error('Only https:// links.')
      return trimmed
    },
    fetchFeed: async (url) => {
      fetches.push(url)
      if (shouldFail) throw Object.assign(new Error('Answered HTTP 404.'), { hint: 'Republish it.' })
      return icsText ?? 'BEGIN:VCALENDAR\nEND:VCALENDAR'
    },
    failFromNowOn: () => (shouldFail = true),
  }

  const keys = {
    isSecureStorageAvailable: () => true,
    saveFeedUrl: async (url) => (storedUrl = url),
    readFeedUrl: async () => storedUrl,
    hasFeedUrl: async () => storedUrl !== null,
    forgetFeedUrl: async () => (storedUrl = null),
  }

  const calendar = createCalendarSync({
    getSettings: () => settings,
    saveSettings: (patch) => (settings = { ...settings, ...patch }),
    onChange: () => {},
    onReminder: (event, kind) => reminders.push([event.id, kind]),
    keys,
    feed,
  })

  return { calendar, reminders, fetches, feed, keys, getSettings: () => settings }
}

test('a relaunch with a stored link reconnects and polls on its own', async () => {
  const startMs = Math.floor((Date.now() + 4 * 60_000) / 1000) * 1000
  const { calendar, keys, reminders } = makeHarness({ icsText: ICS_TEMPLATE('evt-boot', startMs) })
  await keys.saveFeedUrl('https://feed.example/stored.ics')

  await calendar.start()
  // The first poll is kicked off by start(); let it settle.
  await calendar.pollNow()

  assert.equal(calendar.status().connected, true)
  assert.deepEqual(reminders, [[`evt-boot@${new Date(startMs).toISOString()}`, 'soon']])
})

test('a fresh install reports disconnected without touching the network', async () => {
  const { calendar, fetches } = makeHarness()
  await calendar.start()
  assert.equal(calendar.status().connected, false)
  assert.deepEqual(fetches, [])
})

test('connect fetches the feed first and only stores a link that works', async () => {
  const good = makeHarness()
  await good.calendar.connect({ feedUrl: 'https://outlook.office365.com/owa/calendar/x/calendar.ics' })
  assert.equal(good.calendar.status().connected, true)
  assert.equal(good.getSettings().calendarFeed, true)
  assert.equal(good.fetches.length, 1)

  const bad = makeHarness({ fetchFails: true })
  await assert.rejects(bad.calendar.connect({ feedUrl: 'https://example.com/c.ics' }), /404/)
  assert.equal(bad.calendar.status().connected, false)
  assert.equal(bad.getSettings().calendarFeed, false)
})

test('a non-https link is rejected before any fetch happens', async () => {
  const { calendar, fetches } = makeHarness()
  await assert.rejects(calendar.connect({ feedUrl: 'http://calendar.example/x.ics' }))
  assert.deepEqual(fetches, [])
})

test('polling inside the 5-minute window reminds exactly once', async () => {
  const startMs = Math.floor((Date.now() + 3 * 60_000) / 1000) * 1000
  const { calendar, reminders } = makeHarness({ icsText: ICS_TEMPLATE('evt-daily', startMs) })

  await calendar.connect({ feedUrl: 'https://feed.example/c.ics' })
  assert.deepEqual(reminders, [['evt-daily@' + new Date(startMs).toISOString(), 'soon']])

  await calendar.pollNow()
  await calendar.pollNow()
  assert.equal(reminders.length, 1)

  const upcoming = calendar.status().upcoming
  assert.equal(upcoming[0].title, 'Daily standup')
  assert.equal(upcoming[0].joinUrl, 'https://teams.microsoft.com/l/meetup-join/xyz')
})

test('poll failures surface as lastError but keep the connection and upcoming list', async () => {
  const { calendar, feed } = makeHarness({ icsText: ICS_TEMPLATE('evt-later', Math.floor((Date.now() + 40 * 60_000) / 1000) * 1000) })
  await calendar.connect({ feedUrl: 'https://feed.example/c.ics' })
  assert.equal(calendar.status().upcoming.length, 1)
  assert.equal(calendar.status().lastError, null)

  // The feed starts failing — republished link, dead network. The user stays connected
  // and sees why nothing refreshes.
  feed.failFromNowOn()
  await calendar.pollNow()
  assert.equal(calendar.status().connected, true)
  assert.match(calendar.status().lastError, /404/)
})

test('"I\'m in" silences reminders, "Skip it" hides the occurrence everywhere', async () => {
  const startMs = Math.floor((Date.now() + 3 * 60_000) / 1000) * 1000
  // Both events land inside the 5-minute reminder window.
  const laterMs = startMs + 90_000
  const ics = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:first
SUMMARY:First meeting
DTSTART:${new Date(startMs).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')}
DTEND:${new Date(startMs + 1800000).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')}
END:VEVENT
BEGIN:VEVENT
UID:second
SUMMARY:Second meeting
DTSTART:${new Date(laterMs).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')}
DTEND:${new Date(laterMs + 1800000).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')}
END:VEVENT
END:VCALENDAR`

  const { calendar, reminders, getSettings } = makeHarness({ icsText: ics })
  await calendar.connect({ feedUrl: 'https://feed.example/c.ics' })
  assert.equal(reminders.length, 2, 'both inside the window reminded')

  calendar.acknowledge(`first@${new Date(startMs).toISOString()}`)
  await calendar.pollNow()
  assert.equal(reminders.length, 2, 'acknowledged: no re-remind')
  assert.equal(calendar.status().upcoming.length, 2, 'acknowledged: still listed')

  calendar.skip(`second@${new Date(laterMs).toISOString()}`)
  assert.equal(calendar.status().upcoming.length, 1, 'skipped: gone from the list')
  assert.equal(calendar.status().upcoming[0].title, 'First meeting')
  assert.deepEqual(getSettings().calendarSkipped, [`second@${new Date(laterMs).toISOString()}`])

  await calendar.pollNow()
  assert.equal(reminders.length, 2, 'skipped: silent')
})

test('skipped occurrences stay hidden across a restart', async () => {
  const startMs = Math.floor((Date.now() + 3 * 60_000) / 1000) * 1000
  const harness = makeHarness({ icsText: ICS_TEMPLATE('evt-skip', startMs) })
  await harness.calendar.connect({ feedUrl: 'https://feed.example/c.ics' })

  const id = `evt-skip@${new Date(startMs).toISOString()}`
  harness.calendar.skip(id)
  harness.calendar.stop()

  // Fresh instance, same settings store: the skip survives.
  const restarted = makeHarness({ icsText: ICS_TEMPLATE('evt-skip', startMs) })
  restarted.getSettings().calendarSkipped = harness.getSettings().calendarSkipped
  restarted.calendar.start()
  await restarted.calendar.pollNow()
  assert.deepEqual(restarted.calendar.status().upcoming, [])
  assert.deepEqual(restarted.reminders, [])
})

test('disconnect forgets the link and clears the marker', async () => {
  const { calendar, getSettings } = makeHarness()
  await calendar.connect({ feedUrl: 'https://feed.example/c.ics' })
  assert.equal(calendar.status().connected, true)

  await calendar.disconnect()
  assert.equal(calendar.status().connected, false)
  assert.equal(getSettings().calendarFeed, false)
  assert.deepEqual(calendar.status().upcoming, [])
})
