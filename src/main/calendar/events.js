const MINUTE_MS = 60_000

/** Meeting links hide in several Graph fields; check the structured ones first. */
const LINK_PATTERN =
  /https:\/\/(teams\.microsoft\.com|teams\.live\.com|[a-z0-9-]+\.zoom\.us|meet\.google\.com)\/[^\s<>"]+/i

/** Composio hands back the Graph payload, and its shape varies a little between actions. */
const listPayload = (result) => {
  const data = result?.data ?? result
  if (Array.isArray(data?.value)) return data.value
  if (Array.isArray(data?.events)) return data.events
  return Array.isArray(data) ? data : []
}

/*
 * Graph serves wall times in its own Windows timezone names, not IANA ones. The common
 * ones are mapped; an unmapped name falls back to UTC rather than to the machine's own
 * timezone — a shared mailbox has no reason to share the Mac's clock.
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
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - Math.floor(instantMs / 1000) * 1000
}

/**
 * Graph's dateTime is usually a naive wall time in the event's own `timeZone` field.
 * Two passes so DST edges still land right: the offset at the approximated instant
 * refines the instant, once.
 */
export const parseWhen = (dateTime, timeZone) => {
  if (typeof dateTime !== 'string' || !dateTime) return NaN
  if (/z$/i.test(dateTime) || /[+-]\d{2}:?\d{2}$/.test(dateTime)) return Date.parse(dateTime)
  const naiveUtc = Date.parse(`${dateTime.replace(/\.\d+$/, '')}Z`)
  if (!Number.isFinite(naiveUtc)) return NaN

  const zone = WINDOWS_ZONES[timeZone] ?? timeZone
  if (!zone || zone === 'UTC') return naiveUtc

  try {
    let instant = naiveUtc
    for (let pass = 0; pass < 2; pass += 1) instant = naiveUtc - offsetMsAt(instant, zone)
    return instant
  } catch {
    return naiveUtc
  }
}

/** The inverse: a moment rendered as the wall time Graph wants back in a given zone. */
export const wallTime = (instantMs, timeZone) => {
  const p = wallParts(instantMs, timeZone)
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}`
}

export const pickJoinUrl = (event) => {
  const direct = event?.onlineMeeting?.joinUrl ?? event?.onlineMeetingUrl ?? null
  if (direct) return direct

  const text = `${event?.location?.displayName ?? ''}\n${event?.bodyPreview ?? ''}\n${
    event?.body?.content ?? ''
  }`
  return LINK_PATTERN.exec(text)?.[0] ?? null
}

export const isOnlineMeeting = (event) => event?.isOnlineMeeting === true || pickJoinUrl(event) !== null

const readEnd = (event) => {
  const start = event?.start?.dateTime ?? event?.start?.date ?? null
  const end = event?.end?.dateTime ?? event?.end?.date ?? null
  // All-day events carry plain dates; they are worth a note in the list, not a reminder.
  const allDay = Boolean(event?.start?.date && !event?.start?.dateTime) || event?.isAllDay === true
  return { start, end, allDay }
}

export const normaliseEvent = (event) => {
  const { start, end, allDay } = readEnd(event)
  if (!start) return null

  const startMs = allDay
    ? Date.parse(`${start}T09:00:00`)
    : parseWhen(start, event?.start?.timeZone)
  if (!Number.isFinite(startMs)) return null
  const endMs = end
    ? allDay
      ? Date.parse(`${end}T09:00:00`)
      : parseWhen(end, event?.end?.timeZone ?? event?.start?.timeZone)
    : startMs + 30 * MINUTE_MS

  return {
    id: String(event?.id ?? event?.iCalUId ?? `${start}-${event?.subject ?? 'meeting'}`),
    title: String(event?.subject ?? '').trim() || '(no title)',
    startMs,
    endMs: Number.isFinite(endMs) ? endMs : startMs + 30 * MINUTE_MS,
    allDay,
    cancelled: event?.isCancelled === true,
    declined: event?.responseStatus?.response === 'declined',
    joinUrl: pickJoinUrl(event),
    location: event?.location?.displayName ?? '',
    webLink: event?.webLink ?? null,
    online: isOnlineMeeting(event),
  }
}

/** The renderer-facing list: cancelled and declined entries are nobody's afternoon. */
export const upcomingFrom = (result, nowMs, horizonMs) => {
  const seen = new Set()
  return listPayload(result)
    .map(normaliseEvent)
    .filter(
      (event) =>
        event &&
        !event.cancelled &&
        !event.declined &&
        !event.allDay &&
        event.endMs > nowMs &&
        event.startMs <= nowMs + horizonMs &&
        !seen.has(event.id) &&
        (seen.add(event.id), true),
    )
    .sort((a, b) => a.startMs - b.startMs)
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

/**
 * The account may or may not expose a given action name, and Composio has renamed tools
 * over time — pick the first candidate that exists instead of trusting a single string.
 */
export const pickSlug = (available, candidates) =>
  candidates.find((slug) => available.includes(slug)) ?? null

const TEAMS_PROVIDER = 'teamsForBusiness'

/**
 * Arguments for the create-event action. Composio's Outlook actions accept Graph-shaped
 * fields; `is_online_meeting` plus the provider is what turns an event into a real Teams
 * meeting with a join link attached. Times go out as wall times in the named zone, the
 * way Graph interprets them — an ISO UTC string paired with a timeZone would be read as
 * local wall time and shift the meeting by the offset.
 */
export const buildCreateArgs = ({ title, startMs, minutes, timeZone, online, attendees }) => {
  const startWall = wallTime(startMs, timeZone)
  const endWall = wallTime(startMs + minutes * MINUTE_MS, timeZone)
  return {
    subject: title,
    // Both spellings exist across action versions; extra fields are ignored server-side.
    start_date_time: startWall,
    end_date_time: endWall,
    time_zone: timeZone,
    start: { dateTime: startWall, timeZone },
    end: { dateTime: endWall, timeZone },
    is_online_meeting: online,
    ...(online ? { online_meeting_provider: TEAMS_PROVIDER } : {}),
    ...(attendees.length > 0
      ? { attendees: attendees.map((email) => ({ emailAddress: { address: email } })) }
      : {}),
  }
}

/** Emails arrive from a text field: comma or space separated, maybe malformed. */
export const parseAttendees = (text) =>
  String(text ?? '')
    .split(/[\s,;]+/)
    .map((part) => part.trim())
    .filter((part) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(part))
