import { el, setHidden, svgIcon } from '../dom.js'

/**
 * The panel's navigation: one word, five glyphs, and a dot when something is happening.
 *
 * It replaced a strip of five equal pills, which was the wrong shape for two reasons.
 * Five labels shouting equally said nothing about which one you wanted, and they are not
 * even the same kind of thing — Time is a tool you operate, Note is a capture, Clips is
 * history, Meet is a live session, Cal is a glance. And it had run out of room: five tabs
 * fit at 68px each, so a sixth arrived at 53px and every label started to crop.
 *
 * So the destinations collapse to icons and only the open one spends a word. That leaves
 * Chat first and labelled almost always, which is the honest hierarchy for something that
 * is meant to be an agent you talk to.
 *
 * An icon on its own loses state, which is what the labels were quietly carrying, so each
 * destination gets a dot when it has something to say. That is the pattern the MOCO
 * footer dot already uses in this panel: one dot, and the detail on hover.
 */

const GLYPHS = Object.freeze({
  chat: [['path', { d: 'M4 6.5h16v10H9.5L5.5 20v-3.5H4z' }]],
  time: [
    ['circle', { cx: 12, cy: 12, r: 8 }],
    ['path', { d: 'M12 7.5V12l3 2' }],
  ],
  note: [
    ['path', { d: 'M6.5 3.5h11v17h-11z' }],
    ['path', { d: 'M9.5 8h5M9.5 12h5M9.5 16h3' }],
  ],
  clips: [
    ['path', { d: 'M9.5 7.5h9v11h-9z' }],
    ['path', { d: 'M14.5 4.5h-9v11' }],
  ],
  meet: [
    ['path', { d: 'M12 4.5a2.5 2.5 0 0 1 2.5 2.5v4a2.5 2.5 0 0 1-5 0V7A2.5 2.5 0 0 1 12 4.5z' }],
    ['path', { d: 'M6.5 11.5a5.5 5.5 0 0 0 11 0M12 17v3' }],
  ],
  calendar: [
    ['path', { d: 'M4.5 6.5h15v13h-15z' }],
    ['path', { d: 'M4.5 11h15M9 4v3M15 4v3' }],
  ],
})

/**
 * One destination: an icon always, a label when it is the open view, and a dot when it
 * has news. The label is inside the button rather than a tooltip so the open view is
 * named on screen — an app where nothing is named is a guessing game.
 */
const createDestination = ({ id, label, onFocus }) => {
  const dot = el('span', { class: 'dest-dot', 'aria-hidden': 'true', hidden: true })
  const text = el('span', { class: 'dest-label', text: label })

  const root = el(
    'button',
    {
      class: 'dest',
      type: 'button',
      role: 'tab',
      title: label,
      'aria-label': label,
      'aria-selected': 'false',
      onclick: () => onFocus(id),
    },
    [svgIcon(GLYPHS[id]), text, dot],
  )

  return {
    id,
    root,
    setActive: (active) => root.setAttribute('aria-selected', String(active)),
    /**
     * `signal` is `{ state, title }`, or null for nothing to say. `problem` is red and
     * `news` is yellow — the same two colours the footer's MOCO dot established, so a red
     * dot means the same thing everywhere in the panel.
     */
    setSignal: (signal) => {
      setHidden(dot, !signal)
      dot.dataset.state = signal?.state ?? ''
      root.title = signal?.title ? `${label} · ${signal.title}` : label
    },
  }
}

/**
 * What each destination has to say, read out of the snapshot the panel already receives.
 * Nothing here is new state: a dot is a view of something the app already knew and only
 * showed once you were looking at the right tab.
 */
const readSignals = ({ snapshot, seenClipId }) => {
  const { timer, moco, meeting, clips = [], calendar, settings } = snapshot

  /*
   * MOCO lives inside the Time view, so its trouble shows on the Time icon. A failed push
   * outranks a running clock: one is a thing to fix and the other is a thing to see.
   */
  const time =
    moco?.failed > 0
      ? { state: 'problem', title: `${moco.failed} failed to push` }
      : timer
        ? { state: 'news', title: `running · ${timer.task}` }
        : moco?.pending > 0
          ? { state: 'news', title: `${moco.pending} queued for MOCO` }
          : null

  const live = meeting && meeting.phase !== 'idle' && meeting.phase !== 'done'

  /*
   * "Soon" is the same window the reminder strip uses, so the dot and the strip cannot
   * disagree about whether a meeting is imminent.
   */
  const leadMs = (settings?.calendarClockLeadMinutes ?? 15) * 60_000
  const next = calendar?.upcoming?.[0] ?? null
  const now = Date.now()
  const imminent = next && next.startMs <= now + leadMs && next.endMs > now ? next : null

  return {
    chat: null,
    time,
    note: null,
    /*
     * News, not a count: a dot that is lit whenever the clipboard has ever been captured
     * is decoration. It goes out the moment you look at the view — see `setActive`.
     */
    clips: clips.length > 0 && clips[0].id !== seenClipId ? { state: 'news', title: 'new' } : null,
    meet: live ? { state: 'news', title: meeting.phase } : null,
    calendar: imminent
      ? { state: 'news', title: `${imminent.title || 'meeting'} coming up` }
      : null,
  }
}

/**
 * `destinations` is `[id, label]` pairs in rail order; the first is the lead and keeps a
 * little more room, because Chat is the conversation and not a sixth tool.
 */
export const createRail = ({ destinations, onFocus }) => {
  const buttons = new Map(
    destinations.map(([id, label]) => [id, createDestination({ id, label, onFocus })]),
  )

  const root = el(
    'div',
    { class: 'rail', role: 'tablist' },
    destinations.flatMap(([id], index) => [
      buttons.get(id).root,
      // A gap after the lead: it separates the conversation from the tools without a rule.
      index === 0 ? el('span', { class: 'rail-gap' }) : null,
    ]),
  )

  let seenClipId = null
  let lastClipId = null
  let active = destinations[0][0]

  const setActive = (id) => {
    active = id
    for (const [destinationId, destination] of buttons) {
      destination.setActive(destinationId === id)
    }
    // Looking at the clips is what makes them no longer new.
    if (id === 'clips') seenClipId = lastClipId
    root.dataset.active = id
  }

  const update = (snapshot) => {
    lastClipId = snapshot.clips?.[0]?.id ?? null
    if (active === 'clips') seenClipId = lastClipId

    const signals = readSignals({ snapshot, seenClipId })
    for (const [id, destination] of buttons) destination.setSignal(signals[id] ?? null)
  }

  /** A destination the app cannot offer is absent, not disabled and not lying. */
  const setAvailable = (id, available) => {
    const destination = buttons.get(id)
    if (destination) setHidden(destination.root, !available)
  }

  return { root, update, setActive, setAvailable, has: (id) => buttons.has(id) }
}
