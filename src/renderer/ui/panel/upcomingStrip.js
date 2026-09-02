import { el, setHidden } from '../dom.js'

const TICK_MS = 1000

const describeStart = (startMs, now) => {
  const minutesAway = Math.round((startMs - now) / 60_000)
  if (minutesAway <= 0) return 'now'
  return minutesAway === 1 ? 'in 1 min' : `in ${minutesAway} min`
}

/**
 * The running timer has its strip; a meeting about to start gets the same treatment.
 * Join opens the call, Record starts transcription — the two things you do at 14:29:55.
 */
export const createUpcomingStrip = ({ onJoin, onRecord, onOpenCalendar }) => {
  const when = el('span', { class: 'upcoming-when' })
  const label = el('span', { class: 'upcoming-label' })

  const join = el('button', {
    class: 'upcoming-join',
    type: 'button',
    text: 'Join',
    onclick: (event) => (event.stopPropagation(), current?.joinUrl && onJoin(current.joinUrl)),
  })
  const record = el('button', {
    class: 'upcoming-record',
    type: 'button',
    text: 'Record',
    onclick: (event) => (event.stopPropagation(), current && onRecord(current.title)),
  })

  const root = el('button', {
    class: 'upcoming-strip',
    type: 'button',
    title: 'Open the calendar tab',
    onclick: onOpenCalendar,
  }, [el('span', { class: 'rec-dot rec-dot--cal' }), when, label, join, record])

  let current = null
  setInterval(() => render(), TICK_MS)

  const render = () => {
    if (!current) return
    when.textContent = describeStart(current.startMs, Date.now())
    label.textContent = current.title
  }

  const update = (snapshot) => {
    const next = snapshot.calendar?.upcoming?.[0] ?? null
    const leadMs = (snapshot.settings?.calendarClockLeadMinutes ?? 15) * 60_000
    const now = Date.now()

    // Show only when it is actually soon or already running.
    current =
      next && next.startMs <= now + leadMs && next.endMs > now ? next : null

    setHidden(root, !current)
    if (!current) return
    setHidden(join, !current.joinUrl)
    render()
  }

  return { root, update }
}
