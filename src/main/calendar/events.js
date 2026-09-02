const MINUTE_MS = 60_000

/** Meeting links hide in several free-text fields of any feed format. */
const LINK_PATTERN =
  /https:\/\/(teams\.microsoft\.com|teams\.live\.com|[a-z0-9-]+\.zoom\.us|meet\.google\.com)\/[^\s<>"]+/i

export const pickUrlFromText = (text) => LINK_PATTERN.exec(text ?? '')?.[0] ?? null

/*
 * Outlook/Exchange feeds name their zones with Windows labels, not IANA ones. The common
 * ones are mapped; an unknown name passes through so Intl either accepts it or the
 * caller's fallback (UTC) applies — never the Mac's own zone, which a calendar on
 * another machine has no reason to share.
 */
const WINDOWS_ZONES = {
  'Coordinated Universal Time': 'UTC',
  'GMT Standard Time': 'Europe/London',
  'Greenwich Standard Time': 'Atlantic/Reykjavik',
  'W. Europe Standard Time': 'Europe/Berlin',
  'Romance Standard Time': 'Europe/Paris',
  'Central Europe Standard Time': 'Europe/Budapest',
  'Central European Standard Time': 'Europe/Warsaw',
  'Central Standard Time': 'America/Chicago',
  'Eastern Standard Time': 'America/New_York',
  'Mountain Standard Time': 'America/Denver',
  'Pacific Standard Time': 'America/Los_Angeles',
}

export const resolveZone = (timeZone) => WINDOWS_ZONES[timeZone] ?? timeZone

const wallParts = (instantMs, timeZone) =>
  Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
      .formatToParts(instantMs)
      .map((part) => [part.type, part.value]),
  )

const offsetMsAt = (instantMs, timeZone) => {
  const p = wallParts(instantMs, timeZone)
  return (
    Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) -
    Math.floor(instantMs / 1000) * 1000
  )
}

/**
 * Feed times arrive either marked (…Z / …+02:00) or as a naive wall time plus a zone
 * label on the property. Two passes so DST edges land right: the offset at the
 * approximated instant refines the instant, once.
 */
export const parseWhen = (dateTime, timeZone) => {
  if (typeof dateTime !== 'string' || !dateTime) return NaN
  if (/z$/i.test(dateTime) || /[+-]\d{2}:?\d{2}$/.test(dateTime)) return Date.parse(dateTime)
  const naiveUtc = Date.parse(`${dateTime.replace(/\.\d+$/, '')}Z`)
  if (!Number.isFinite(naiveUtc)) return NaN

  const zone = resolveZone(timeZone)
  if (!zone || zone === 'UTC') return naiveUtc

  try {
    let instant = naiveUtc
    for (let pass = 0; pass < 2; pass += 1) instant = naiveUtc - offsetMsAt(instant, zone)
    return instant
  } catch {
    return naiveUtc
  }
}

/**
 * Which reminders to fire right now. `reminded` is a Set of `${id}:${kind}` so each event
 * reminds once per kind; firing is a side effect of the caller, this only reports.
 */
export const dueReminders = (events, nowMs, reminded, remindMinutes, startGraceMinutes) => {
  const due = []
  for (const event of events) {
    const minutesAway = (event.startMs - nowMs) / MINUTE_MS

    if (minutesAway > 0 && minutesAway <= remindMinutes) {
      const key = `${event.id}:soon`
      if (!reminded.has(key)) due.push({ event, kind: 'soon', key })
    }
    if (minutesAway <= 0 && minutesAway > -startGraceMinutes) {
      const key = `${event.id}:now`
      if (!reminded.has(key)) due.push({ event, kind: 'now', key })
    }
  }
  return due
}
