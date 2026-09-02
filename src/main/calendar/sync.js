import { CALENDAR } from '../constants.js'
import { dueReminders } from './events.js'
import { eventsFromIcs } from './ics.js'
import * as feedClient from './feed.js'

const HORIZON_MS = CALENDAR.horizonHours * 60 * 60 * 1000

// Reminders die with the process; this just stops a long-lived app from growing it forever.
const REMINDED_CAP = 500

/**
 * Owns the calendar feed: the Keychain-stored ICS link, the polling that keeps upcoming
 * meetings fresh, and the reminders that result from them. There is no OAuth state
 * machine anymore — a stored, working URL *is* the connection.
 *
 * `keys` and `feed` are injected: the real store touches `electron`, which cannot load
 * in a plain Node test. Production wiring lives in app.js.
 */
export const createCalendarSync = ({
  getSettings,
  saveSettings,
  onChange,
  onReminder,
  keys,
  feed = feedClient,
}) => {
  let events = []
  let connected = false
  let lastError = null
  let lastPollAt = 0
  let poller = null
  let polling = false
  const reminded = new Set()

  const notify = () => onChange?.()

  // Skipped occurrences are invisible everywhere: strip, tab, clock.
  const skipped = new Set(getSettings().calendarSkipped ?? [])
  const upcomingWindow = () =>
    events
      .filter((event) => event.endMs > Date.now() && !skipped.has(event.id))
      .slice(0, 5)

  const status = () => ({
    available: keys.isSecureStorageAvailable(),
    connected,
    upcoming: upcomingWindow(),
    lastError,
    lastPollAt,
  })

  const start = async () => {
    connected = await keys.hasFeedUrl()
    notify()
    if (connected) {
      startPolling()
      void pollNow()
    }
  }

  /** "I'm in" — no more bubbles for this occurrence; the strip stays for Join/Record. */
  const acknowledge = (eventId) => {
    reminded.add(`${eventId}:soon`)
    reminded.add(`${eventId}:now`)
    notify()
  }

  /** "Skip it" — silent like acknowledge, and the occurrence hides everywhere too. */
  const skip = (eventId) => {
    acknowledge(eventId)
    skipped.add(eventId)
    saveSettings({ calendarSkipped: [...skipped] })
    notify()
  }

  const startPolling = () => {
    if (poller) return
    poller = setInterval(() => {
      void pollNow()
    }, CALENDAR.pollMs)
    // Never the reason a process stays alive — Electron's app loop is that already.
    poller.unref?.()
  }

  /** Parse one feed body into state and fire whatever reminders are due from it. */
  const ingest = (text) => {
    events = eventsFromIcs(text, Date.now(), HORIZON_MS)
    lastError = null
    lastPollAt = Date.now()

    if (reminded.size > REMINDED_CAP) reminded.clear()

    for (const { event, kind, key } of dueReminders(
      events,
      Date.now(),
      reminded,
      CALENDAR.remindMinutes,
      CALENDAR.startGraceMinutes,
    )) {
      reminded.add(key)
      onReminder?.(event, kind)
    }
  }

  /** A link is only stored after it actually served a calendar. */
  const connect = async ({ feedUrl }) => {
    const url = feed.normaliseFeedUrl(feedUrl)
    const text = await feed.fetchFeed(url)

    await keys.saveFeedUrl(url)
    saveSettings({ calendarFeed: true })
    connected = true
    startPolling()
    // The validation fetch already carried the data; a follow-up poll would be a second
    // network hop for the same bytes.
    ingest(text)
    notify()
    return status()
  }

  const disconnect = async () => {
    await keys.forgetFeedUrl()
    saveSettings({ calendarFeed: false })
    connected = false
    events = []
    lastError = null
    stop()
    notify()
  }

  const pollNow = async () => {
    if (!connected || polling) return
    polling = true

    try {
      const url = await keys.readFeedUrl()
      if (!url) throw new Error('No calendar link is stored.')

      ingest(await feed.fetchFeed(url))
    } catch (error) {
      lastError = `${error.message} ${error.hint ?? ''}`.trim()
      console.warn('[calendar] poll failed:', error.message)
    }
    polling = false
    notify()
  }

  const stop = () => {
    if (poller) clearInterval(poller)
    poller = null
  }

  return {
    start,
    connect,
    disconnect,
    pollNow,
    acknowledge,
    skip,
    status,
    isConnected: () => connected,
    upcoming: upcomingWindow,
    stop,
  }
}
