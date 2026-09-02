import { el, setHidden } from './dom.js'
import { formatElapsed } from './format.js'

const TICK_MS = 1000

/*
 * What the phases mean to someone glancing at the desktop. Processing can take minutes
 * after a long meeting, and silence there reads as a hang.
 */
const MEETING_LABELS = Object.freeze({
  'downloading-model': 'Fetching transcriber',
  transcribing: 'Transcribing',
  summarising: 'Summarising',
})

/**
 * A tiny always-on badge next to the character saying what it is busy with. Status only
 * when there is status — with nothing running it is not on screen at all, so an idle
 * companion stays a companion rather than a dashboard.
 *
 * Lives on the stage rather than in the panel, because the point is to be visible when
 * the panel is shut.
 */
export const createStatusPill = () => {
  const meetingIcon = el('span', { class: 'pill-icon' })
  const meetingText = el('span', { class: 'pill-text' })
  const meeting = el('div', { class: 'pill', 'data-mode': 'meeting' }, [meetingIcon, meetingText])

  const timerIcon = el('span', { class: 'pill-icon' }, ['⏱'])
  const timerText = el('span', { class: 'pill-text' })
  const timer = el('div', { class: 'pill', 'data-mode': 'tracking' }, [timerIcon, timerText])

  const root = el('div', { class: 'status-pill', 'aria-live': 'polite' }, [meeting, timer])

  let timerSince = null
  let meetingSince = null

  const tick = () => {
    if (timerSince !== null) timerText.textContent = formatElapsed(Date.now() - timerSince)
    if (meetingSince !== null) meetingText.textContent = formatElapsed(meetingSince)
  }
  setInterval(tick, TICK_MS)

  const updateMeeting = (state) => {
    const phase = state?.phase
    if (phase === 'recording') {
      // Seconds come from the capture helper, so the badge shows what is actually on
      // disk rather than a wall clock that drifts from it.
      meetingSince = Math.round((state.seconds ?? 0) * 1000)
      meetingIcon.textContent = '🎙'
      setHidden(meeting, false)
      return true
    }

    meetingSince = null
    const label = MEETING_LABELS[phase]
    if (label) {
      meetingIcon.textContent = '✎'
      meetingText.textContent =
        phase === 'downloading-model' && Number.isFinite(state.ratio)
          ? `${label} ${Math.round(state.ratio * 100)}%`
          : label
      setHidden(meeting, false)
      return true
    }

    setHidden(meeting, true)
    return false
  }

  const update = ({ timer: activeTimer, meeting: meetingState }) => {
    const showMeeting = updateMeeting(meetingState)

    timerSince = activeTimer ? activeTimer.startedAt : null
    setHidden(timer, !activeTimer)

    setHidden(root, !showMeeting && !activeTimer)
    tick()
  }

  return { root, update }
}
