import { parseWhen, pickUrlFromText, resolveZone } from './events.js'

/**
 * A published Outlook calendar is plain iCalendar over HTTPS — no OAuth, no library.
 * The parser covers what that feed actually sends: folded lines, TZID wall times (with
 * Windows zone names), daily/weekly recurrence with BYDAY/INTERVAL/COUNT/UNTIL, and
 * EXDATE skips. Monthly/yearly rules fall back to the base instance — the feed is
 * read-only, so under-reading is a visible gap, never silent corruption.
 */

// Safety net against pathological rules (COUNT=1000000 & co.).
const MAX_OCCURRENCES = 1000
const DAY_MS = 24 * 60 * 60 * 1000
const DEFAULT_DURATION_MS = 30 * 60_000

const WEEKDAYS = Object.freeze(['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'])

/** Folded lines continue with a leading space or tab; everything else starts a record. */
const unfold = (text) => String(text ?? '').replace(/\r\n[ \t]|\r[ \t]|\n[ \t]/g, '')

const unescapeText = (value) =>
  String(value ?? '')
    .replace(/\\n/gi, '\n')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\\\/g, '\\')

/** `NAME;PARAM=A;PARAM=B:value` → { name, params, value }. Values may contain colons. */
const parseLine = (line) => {
  const splitAt = line.indexOf(':')
  if (splitAt < 1) return null
  const [name, ...paramParts] = line.slice(0, splitAt).split(';')
  const params = {}
  for (const part of paramParts) {
    const [key, value] = part.split('=')
    if (key && value) params[key.toUpperCase()] = value
  }
  return { name: name.toUpperCase(), params, value: line.slice(splitAt + 1) }
}

/** "20260902T140000Z" → "2026-09-02T14:00:00Z", the shape parseWhen understands. */
const iso = (value) => {
  const match = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/.exec(value ?? '')
  if (!match) return null
  const [, y, mo, d, h, mi, s, z] = match
  return `${y}-${mo}-${d}T${h}:${mi}:${s}${z}`
}

const isDateOnly = (value) => /^\d{8}$/.test(value ?? '')

const wallFields = (instantMs, timeZone) => {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: resolveZone(timeZone),
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
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}:${parts.second}`,
  }
}

/**
 * Recurrence stepping touches the *fields* in the feed's zone and only then converts back
 * to an instant — adding raw 24h jumps to a UTC instant would drift across DST changes.
 * Without a zone there are no fields to project into, so a plain day step is correct.
 */
const shiftWallDays = (startMs, zone, days) => {
  if (!zone) return startMs + days * DAY_MS
  const wall = wallFields(startMs, zone)
  const [date] = new Date(Date.parse(`${wall.date}T${wall.time}Z`) + days * DAY_MS)
    .toISOString()
    .split('T')
  return parseWhen(`${date}T${wall.time}`, zone)
}

const parseRrule = (value) => {
  if (!value) return null
  const rule = Object.fromEntries(
    String(value)
      .split(';')
      .map((part) => part.split('='))
      .filter(([key, val]) => key && val)
      .map(([key, val]) => [key.toUpperCase(), val]),
  )
  if (!rule.FREQ) return null
  return {
    freq: rule.FREQ,
    interval: Math.max(1, Number.parseInt(rule.INTERVAL ?? '1', 10) || 1),
    count: Number.parseInt(rule.COUNT ?? '', 10) || null,
    // UNTIL comes as an ICS datetime; parse it standalone (its zone is the rule's).
    until: rule.UNTIL ? parseWhen(iso(rule.UNTIL) ?? rule.UNTIL, undefined) : null,
    byDay: (rule.BYDAY ?? '')
      .split(',')
      .map((day) => day.trim().toUpperCase())
      .filter((day) => WEEKDAYS.includes(day)),
  }
}

/** All occurrence start instants, earliest first. Bounded by count/until and the cap. */
function* generate({ startMs, rrule, zone }) {
  if (!rrule || (rrule.freq !== 'DAILY' && rrule.freq !== 'WEEKLY')) {
    yield startMs
    return
  }

  const startWeekdayIndex = (new Date(startMs).getUTCDay() + 6) % 7
  let produced = 0

  if (rrule.freq === 'DAILY') {
    for (let day = 0; produced < MAX_OCCURRENCES; day += rrule.interval) {
      const ms = shiftWallDays(startMs, zone, day)
      if (rrule.until !== null && ms > rrule.until) return
      produced += 1
      yield ms
      if (rrule.count !== null && produced >= rrule.count) return
    }
    return
  }

  // WEEKLY: BYDAY names the days of each rule week, relative to the DTSTART weekday.
  // Without BYDAY, the DTSTART weekday itself is the only day.
  const days = (rrule.byDay.length > 0 ? rrule.byDay : [WEEKDAYS[startWeekdayIndex]]).sort(
    (a, b) => WEEKDAYS.indexOf(a) - WEEKDAYS.indexOf(b),
  )
  for (let week = 0; produced < MAX_OCCURRENCES; week += rrule.interval) {
    for (const day of days) {
      const offset = WEEKDAYS.indexOf(day) - startWeekdayIndex
      const ms = shiftWallDays(startMs, zone, week * 7 + offset)
      // Occurrences before DTSTART are not occurrences (RFC 5545).
      if (ms < startMs) continue
      if (rrule.until !== null && ms > rrule.until) return
      produced += 1
      yield ms
      if (rrule.count !== null && produced >= rrule.count) return
    }
  }
}

/**
 * One VEVENT block → occurrence starts inside [nowMs, nowMs+horizonMs], with the event's
 * duration. All-day entries are notes on a day, not meetings: no reminders, no clock.
 * `skip` holds RECURRENCE-ID instants of override blocks sharing this UID: the master
 * rule must not also emit those, or the meeting lists twice.
 */
const expandBlock = (props, nowMs, horizonMs, skip = new Set()) => {
  const dtstart = props.get('DTSTART')?.[0]
  if (!dtstart) return []
  if (dtstart.params.VALUE === 'DATE' || isDateOnly(dtstart.value)) return []
  if ((props.get('STATUS')?.[0]?.value ?? '').toUpperCase() === 'CANCELLED') return []

  const zone = dtstart.params.TZID
  const startMs = parseWhen(iso(dtstart.value) ?? dtstart.value, zone)
  if (!Number.isFinite(startMs)) return []

  const dtend = props.get('DTEND')?.[0]
  const endMs = dtend ? parseWhen(iso(dtend.value) ?? dtend.value, zone) : NaN
  const durationMs = Number.isFinite(endMs) && endMs > startMs ? endMs - startMs : DEFAULT_DURATION_MS

  const exdates = new Set(
    (props.get('EXDATE') ?? [])
      .flatMap((prop) => prop.value.split(','))
      .map((value) => parseWhen(iso(value.trim()) ?? value.trim(), zone))
      .filter(Number.isFinite),
  )

  const rrule = parseRrule(props.get('RRULE')?.[0]?.value)
  const limit = nowMs + horizonMs

  const found = []
  for (const ms of generate({ startMs, rrule, zone })) {
    if (ms > limit) break
    if (ms + durationMs > nowMs && !exdates.has(ms) && !skip.has(ms)) found.push(ms)
  }
  return found.map((ms) => ({ startMs: ms, durationMs }))
}

const toEvent = (props, { startMs, durationMs }) => {
  const uid = props.get('UID')?.[0]?.value ?? `${startMs}-${props.get('SUMMARY')?.[0]?.value ?? ''}`
  const summary = unescapeText(props.get('SUMMARY')?.[0]?.value ?? '').trim() || '(no title)'
  const location = unescapeText(props.get('LOCATION')?.[0]?.value ?? '')
  const description = unescapeText(props.get('DESCRIPTION')?.[0]?.value ?? '')
  const joinUrl = pickUrlFromText(`${location}\n${description}`)

  return {
    // Per-instance id: a recurring meeting reminds each day, not just the day it started.
    id: `${uid}@${new Date(startMs).toISOString()}`,
    title: summary,
    startMs,
    endMs: startMs + durationMs,
    allDay: false,
    cancelled: false,
    declined: false,
    joinUrl,
    location,
    webLink: null,
    online: joinUrl !== null,
    hasOverride: Boolean(props.get('RECURRENCE-ID')),
  }
}

/** RECURRENCE-ID marks a block as "the moved/edited version of this one occurrence". */
const recurrenceIdMs = (props, zone) => {
  const rid = props.get('RECURRENCE-ID')?.[0]
  if (!rid) return null
  return parseWhen(iso(rid.value) ?? rid.value, rid.params.TZID ?? zone)
}

/** The whole feed → the same event shape the rest of the calendar feature consumes. */
export const eventsFromIcs = (text, nowMs, horizonMs) => {
  const lines = unfold(text).split(/\r\n|\r|\n/)
  const blocks = []
  let block = null

  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') {
      block = []
      continue
    }
    if (line === 'END:VEVENT' && block) {
      const props = new Map()
      for (const raw of block) {
        const parsed = parseLine(raw)
        if (!parsed) continue
        const list = props.get(parsed.name) ?? []
        list.push(parsed)
        props.set(parsed.name, list)
      }
      blocks.push(props)
      block = null
      continue
    }
    if (block) block.push(line)
  }

  // Overrides travel with the same UID as their series' master. Their RECURRENCE-ID
  // instant must not also expand out of the master's rule.
  const overridden = new Map()
  for (const props of blocks) {
    const uid = props.get('UID')?.[0]?.value
    const zone = props.get('DTSTART')?.[0]?.params?.TZID
    const ridMs = recurrenceIdMs(props, zone)
    if (uid && Number.isFinite(ridMs)) {
      const set = overridden.get(uid) ?? new Set()
      set.add(ridMs)
      overridden.set(uid, set)
    }
  }

  const byId = new Map()
  for (const props of blocks) {
    const uid = props.get('UID')?.[0]?.value
    // Skip applies to the series master only: an override's own RECURRENCE-ID instant
    // equals its DTSTART (a same-time edit), so skipping it there would erase the
    // replacement together with the original.
    const skip = !props.get('RECURRENCE-ID') && uid ? overridden.get(uid) : undefined
    for (const occurrence of expandBlock(props, nowMs, horizonMs, skip)) {
      const event = toEvent(props, occurrence)
      // An override block for a same-instant event beats the master copy (edited text).
      const existing = byId.get(event.id)
      if (!existing || event.hasOverride) byId.set(event.id, event)
    }
  }

  return [...byId.values()].sort((a, b) => a.startMs - b.startMs)
}
