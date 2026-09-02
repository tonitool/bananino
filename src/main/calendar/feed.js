import { CALENDAR } from '../constants.js'

export class FeedError extends Error {
  constructor(message, hint) {
    super(message)
    this.name = 'FeedError'
    this.hint = hint
  }
}

/** Whatever the user pasted, as a validated URL object, or null. */
export const normaliseFeedUrl = (value) => {
  let parsed
  try {
    parsed = new URL(String(value ?? '').trim())
  } catch {
    throw new FeedError('That is not a link.', 'Paste the ICS address from Outlook → Calendar sharing.')
  }
  if (parsed.protocol !== 'https:') {
    throw new FeedError('Only https:// calendar links are accepted.', 'The published address starts with https.')
  }
  return parsed.href
}

/** One read of the published feed. Proof of life for Connect, and the poll's only job. */
export const fetchFeed = async (url, signal) => {
  const response = await fetch(url, {
    signal: signal ?? AbortSignal.timeout(CALENDAR.feedTimeoutMs),
    headers: { Accept: 'text/calendar, text/plain, */*' },
  }).catch((error) => {
    throw new FeedError(`The calendar link could not be fetched: ${error.message}`, 'Check your connection.')
  })

  if (!response.ok) {
    throw new FeedError(
      `The calendar link answered HTTP ${response.status}.`,
      'Republish the calendar in Outlook and paste the new address.',
    )
  }

  const text = await response.text()
  if (!text.includes('BEGIN:VCALENDAR')) {
    throw new FeedError(
      'That link does not serve a calendar.',
      'Use the "ICS" link from Outlook → Settings → Calendar → Shared calendars.',
    )
  }
  return text
}
