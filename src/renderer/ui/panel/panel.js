import { el, setHidden } from '../dom.js'
import { createTimerStrip } from './timerStrip.js'
import { createNoteTab } from './noteTab.js'
import { createClipsTab } from './clipsTab.js'
import { createMeetingTab } from './meetingTab.js'
import { createMocoBar } from './mocoBar.js'
import { createRunningStrip } from './runningStrip.js'
import { createUpcomingStrip } from './upcomingStrip.js'
import { createCalendarTab } from './calendarTab.js'
import { createManualEntry } from './manualEntry.js'
import { formatMinutes } from '../format.js'

/**
 * One view at a time. Everything used to be stacked on a single fixed-height panel — a
 * timer, a sync bar, a tab, a costume row and a footer — which left each part too small
 * and, when any of them grew, overlapping the others.
 */
const TABS = [
  ['time', 'Time'],
  ['note', 'Note'],
  ['clips', 'Clips'],
  ['meet', 'Meet'],
  ['calendar', 'Cal'],
]

/**
 * The panel itself: a timer strip that is always in reach, and one tab for writing notes
 * and one for the clipboard. The character overlaps its top edge, so the panel reads as
 * something the buddy is holding rather than a separate window.
 */
export const createPanel = ({ actions }) => {
  const timer = createTimerStrip({
    onStart: actions.startTimer,
    onStop: actions.stopTimer,
    onDescribe: actions.describeTimer,
    onNudge: actions.nudgeTimer,
  })
  const note = createNoteTab({
    onSave: actions.saveNote,
    onMenu: actions.noteMenu,
    onDelete: actions.deleteNote,
  })
  const clips = createClipsTab({
    onCopy: actions.copyClip,
    onPin: actions.pinClip,
    onDelete: actions.deleteClip,
    onClear: actions.clearClips,
  })

  const moco = createMocoBar({
    onConnect: actions.mocoConnect,
    onDisconnect: actions.mocoDisconnect,
    onPush: actions.mocoPush,
    onRefresh: actions.mocoRefresh,
    onDiscard: actions.mocoDiscard,
  })

  const running = createRunningStrip({
    onStop: actions.stopTimer,
    onOpenTime: () => focusTab('time'),
  })

  const manual = createManualEntry({ onAdd: actions.addManualTime })

  /**
   * Starting a timer and adding time you forgot are two ways of doing one thing, so only
   * one is on screen. Showing both meant a dozen controls at once, and the panel ran out
   * of room the moment the manual form opened.
   */
  const MODES = [
    ['live', 'Timer', timer],
    ['manual', 'Add past', manual],
  ]

  const modeButtons = new Map(
    MODES.map(([id, label]) => [
      id,
      el('button', {
        class: 'submode',
        type: 'button',
        role: 'tab',
        text: label,
        onclick: () => focusMode(id),
      }),
    ]),
  )

  function focusMode(id) {
    for (const [modeId, , view] of MODES) {
      const isActive = modeId === id
      modeButtons.get(modeId).setAttribute('aria-selected', String(isActive))
      setHidden(view.root, !isActive)
    }
    MODES.find(([modeId]) => modeId === id)?.[2].focus()
  }

  const time = {
    root: el('section', { class: 'tab-panel', id: 'tab-time', role: 'tabpanel' }, [
      el('div', { class: 'submodes', role: 'tablist' }, [...modeButtons.values()]),
      timer.root,
      manual.root,
      moco.root,
    ]),
    update: () => {},
    focus: timer.focus,
  }

  /** The whole MOCO status in one dot, with the detail on hover. */
  function updateMocoDot(moco) {
    if (!moco) return setHidden(mocoDot, true)
    setHidden(mocoDot, false)

    const state = !moco.connected
      ? 'off'
      : moco.failed > 0
        ? 'failed'
        : moco.pending > 0
          ? 'pending'
          : 'ok'

    mocoDot.dataset.state = state
    mocoDot.title = moco.connected
      ? `MOCO ${moco.subdomain} · ${moco.taskCount} tasks${
          moco.pending > 0 ? ` · ${moco.pending} queued` : ''
        }`
      : 'MOCO not connected'
  }

  focusMode('live')

  const meet = createMeetingTab({
    onStart: (payload) => actions.startMeeting(payload),
    onStop: () => actions.stopMeeting(),
  })

  const upcoming = createUpcomingStrip({
    onJoin: (url) => actions.calendarJoin(url),
    onRecord: (title) => {
      actions.startMeeting({ title })
      focusTab('meet')
    },
    onAcknowledge: (id) => actions.calendarAcknowledge(id),
    onSkip: (id) => actions.calendarSkip(id),
    onOpenCalendar: () => focusTab('calendar'),
  })

  const calendar = createCalendarTab({
    onConnect: (payload) => actions.calendarConnect(payload),
    onDisconnect: () => actions.calendarDisconnect(),
    onJoin: (url) => actions.calendarJoin(url),
    onRecord: (title) => {
      actions.startMeeting({ title })
      focusTab('meet')
    },
    onSkip: (id) => actions.calendarSkip(id),
    onRefresh: () => actions.calendarRefresh(),
  })

  const panels = { time, note, clips, meet, calendar }
  let activeTab = 'note'

  const tabButtons = new Map(
    TABS.map(([id, label]) => [
      id,
      el('button', {
        class: 'tab',
        type: 'button',
        role: 'tab',
        text: label,
        onclick: () => focusTab(id),
      }),
    ]),
  )

  const summary = el('span', { class: 'summary' })
  const mocoDot = el('span', { class: 'moco-dot', 'aria-hidden': 'true' })

  const root = el('section', { class: 'panel', 'aria-label': 'Bananino' }, [
    running.root,
    upcoming.root,
    el('div', { class: 'tabs', role: 'tablist' }, [...tabButtons.values()]),
    time.root,
    note.root,
    clips.root,
    meet.root,
    calendar.root,
    el('footer', { class: 'panel-footer' }, [
      mocoDot,
      summary,
      el('button', {
        class: 'link',
        type: 'button',
        text: 'Open folder',
        onclick: actions.revealData,
      }),
    ]),
  ])

  /** Unknown ids fall back rather than blanking the panel. */
  function focusTab(requested) {
    const id = Object.hasOwn(panels, requested) ? requested : TABS[0][0]
    activeTab = id
    for (const [tabId, button] of tabButtons) {
      button.setAttribute('aria-selected', String(tabId === id))
      setHidden(panels[tabId].root, tabId !== id)
    }
    panels[id].focus()
  }

  /**
   * The window follows the panel's own height. Fixed per-view heights could not work:
   * the number of recent chips, the manual form and the queue all change how much room a
   * view needs, so the content has to be the source of truth.
   */
  let reportedHeight = 0
  const reportHeight = () => {
    const height = Math.ceil(root.offsetHeight)
    if (height === 0 || Math.abs(height - reportedHeight) < 3) return
    reportedHeight = height
    actions.setPanelHeight(height)
  }

  if (typeof ResizeObserver === 'function') {
    new ResizeObserver(reportHeight).observe(root)
  }

  const update = (snapshot) => {
    running.update(snapshot)
    upcoming.update(snapshot)
    timer.update(snapshot)
    moco.update(snapshot)
    note.update(snapshot)
    clips.update(snapshot)
    meet.update(snapshot)
    calendar.update(snapshot)

    const { today } = snapshot
    summary.textContent = `${formatMinutes(today.minutes)} tracked · ${today.notes} ${
      today.notes === 1 ? 'note' : 'notes'
    }`

    updateMocoDot(snapshot.moco)
    reportHeight()
  }

  focusTab('time')

  return {
    root,
    update,
    setMocoTasks: (tasks) => {
      timer.setMocoTasks(tasks)
      manual.setMocoTasks(tasks)
    },
    resetManual: manual.reset,
    focusTab,
    clearNoteInput: note.clearInput,
    focusActive: () => panels[activeTab].focus(),
  }
}
