import assert from 'node:assert/strict'
import test from 'node:test'
import { createCalendarSync } from '../src/main/calendar/sync.js'

/**
 * The sync module with the network and the Keychain replaced by fakes, so the link
 * lifecycle and the reminder machine can be tested the way the rest of the pure code is.
 */
const makeHarness = ({ accountActive = false, events = [], slugs } = {}) => {
  let settings = { calendarAuthConfigId: '', calendarAccountId: '' }
  let storedKey = null
  const reminders = []
  const changes = []

  const api = {
    listTools: async () => slugs ?? ['OUTLOOK_LIST_CALENDAR_VIEW_EVENTS', 'OUTLOOK_CREATE_ME_EVENT'],
    listAuthConfigs: async () => [{ id: 'ac_dashboard' }],
    createAuthConfig: async () => ({ id: 'ac_created' }),
    createLinkSession: async () => ({ redirectUrl: 'https://login.example/abc', accountId: 'ca_1' }),
    getAccount: async () => ({ status: accountActive ? 'ACTIVE' : 'INITIATED' }),
    accountIsActive: (account) => String(account?.status ?? '').toUpperCase() === 'ACTIVE',
    executeAction: async () => ({ data: { value: events } }),
  }

  const keys = {
    isSecureStorageAvailable: () => true,
    saveApiKey: async (key) => (storedKey = key),
    readApiKey: async () => storedKey,
    hasApiKey: async () => storedKey !== null,
    forgetApiKey: async () => (storedKey = null),
  }

  const calendar = createCalendarSync({
    getSettings: () => settings,
    saveSettings: (patch) => (settings = { ...settings, ...patch }),
    onChange: () => changes.push(calendar.status()),
    onReminder: (event, kind) => reminders.push([event.id, kind]),
    api,
    keys,
  })

  return { calendar, reminders, changes, getSettings: () => settings, api }
}

test('a fresh install reports disconnected without touching the network', async () => {
  const { calendar } = makeHarness()
  await calendar.start()
  const status = calendar.status()
  assert.equal(status.keySaved, false)
  assert.equal(status.linked, false)
  assert.equal(status.linking, false)
})

test('connect verifies and stores the key, and a blank auth config id keeps the old one', async () => {
  const { calendar, getSettings } = makeHarness()
  getSettings() // settings start blank

  await calendar.connect({ apiKey: 'cmp_live_key', authConfigId: '' })
  assert.equal(calendar.status().keySaved, true)
  assert.equal(getSettings().calendarAuthConfigId, '')

  // A stored id survives a re-connect whose field was left empty.
  getSettings().calendarAuthConfigId = 'ac_keep_me'
  await calendar.connect({ apiKey: 'cmp_live_key', authConfigId: '' })
  assert.equal(getSettings().calendarAuthConfigId, 'ac_keep_me')
})

test('connect rejects an account whose toolkit list is empty', async () => {
  const { calendar } = makeHarness({ slugs: [] })
  await assert.rejects(calendar.connect({ apiKey: 'k', authConfigId: '' }), /no Outlook tools/i)
  assert.equal(calendar.status().keySaved, false)
})

test('beginLink enters linking, cancelLink leaves it cleanly', async () => {
  const { calendar } = makeHarness()
  await calendar.connect({ apiKey: 'k', authConfigId: '' })

  const session = await calendar.beginLink()
  assert.equal(session.redirectUrl, 'https://login.example/abc')
  assert.equal(calendar.status().linking, true)

  // The consent page was closed without finishing — the Link button must come back.
  calendar.cancelLink()
  assert.equal(calendar.status().linking, false)
  assert.equal(calendar.status().linked, false)
})

test('checkLink flips to linked once Microsoft says yes, then polling serves reminders', async () => {
  const startMs = Date.now() + 3 * 60_000 // starts in 3 minutes: inside the 5-minute window
  const harness = makeHarness({
    accountActive: true,
    events: [
      {
        id: 'evt-daily',
        subject: 'Daily standup',
        start: { dateTime: new Date(startMs).toISOString(), timeZone: 'UTC' },
        end: { dateTime: new Date(startMs + 30 * 60_000).toISOString(), timeZone: 'UTC' },
      },
    ],
  })
  const { calendar, reminders } = harness

  await calendar.connect({ apiKey: 'k', authConfigId: '' })
  await calendar.beginLink()
  const linked = await calendar.checkLink()
  assert.equal(linked, true)
  assert.equal(calendar.status().linked, true)

  // The initial poll after linking saw the upcoming meeting and reminded once.
  await calendar.pollNow()
  assert.deepEqual(reminders, [['evt-daily', 'soon']])

  // Polling again inside the same window must not re-notify.
  await calendar.pollNow()
  assert.equal(reminders.length, 1)

  const upcoming = calendar.status().upcoming
  assert.equal(upcoming.length, 1)
  assert.equal(upcoming[0].title, 'Daily standup')
})

test('disconnect forgets the key and the link', async () => {
  const { calendar, getSettings } = makeHarness({ accountActive: true })
  await calendar.connect({ apiKey: 'k', authConfigId: '' })
  await calendar.beginLink()
  await calendar.checkLink()

  await calendar.disconnect()
  assert.equal(calendar.status().keySaved, false)
  assert.equal(calendar.status().linked, false)
  assert.equal(getSettings().calendarAccountId, '')
})
