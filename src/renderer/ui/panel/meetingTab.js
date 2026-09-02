import { clear, el, setHidden } from '../dom.js'
import { formatElapsed } from '../format.js'

const PHASE_TEXT = Object.freeze({
  idle: 'Not recording',
  recording: 'Listening',
  'downloading-model': 'Fetching the transcriber',
  transcribing: 'Transcribing',
  summarising: 'Writing it up',
  done: 'Finished',
})

/**
 * Record a meeting, then get a note out of it.
 *
 * Transcription always happens on this Mac. The summary can fall back to the cloud, and
 * when it does the footnote here says so — a transcript leaving the machine should never
 * be something the user has to infer.
 */
export const createMeetingTab = ({ onStart, onStop }) => {
  const title = el('input', {
    class: 'timer-input',
    type: 'text',
    placeholder: 'What is this meeting?',
    'aria-label': 'Meeting title',
  })

  const record = el('button', {
    class: 'button button--primary',
    type: 'button',
    text: 'Record',
    onclick: () => {
      if (isRecording) return onStop()
      onStart({ title: title.value.trim() })
    },
  })

  const phase = el('span', { class: 'hint' })
  const levels = el('span', { class: 'meeting-levels', 'aria-hidden': 'true' })
  const warnings = el('ul', { class: 'meeting-warnings', 'aria-label': 'Recording problems' })
  const privacy = el('p', { class: 'meeting-privacy' })

  const root = el('section', { class: 'tab-panel', id: 'tab-meet', role: 'tabpanel' }, [
    title,
    el('div', { class: 'row' }, [phase, levels, record]),
    warnings,
    privacy,
  ])

  let isRecording = false

  /** Two coarse bars: enough to see that both sides are actually being heard. */
  const renderLevels = (state) => {
    if (state?.phase !== 'recording') return setHidden(levels, true)
    const bar = (value) => {
      const filled = Math.min(4, Math.round((value ?? 0) * 60))
      return '▁▃▅▇'.slice(0, Math.max(1, filled)).padEnd(4, '·')
    }
    levels.textContent = `them ${bar(state.levels?.system)}  you ${bar(state.levels?.mic)}`
    setHidden(levels, false)
  }

  const update = (snapshot) => {
    const state = snapshot.meeting ?? { phase: 'idle' }
    isRecording = state.phase === 'recording'

    record.textContent = isRecording ? 'Stop & write up' : 'Record'
    record.disabled =
      state.phase !== 'idle' && state.phase !== 'recording' && state.phase !== 'done'
    title.disabled = isRecording

    const label = PHASE_TEXT[state.phase] ?? state.phase
    phase.textContent = isRecording
      ? `${label} · ${formatElapsed(Math.round((state.seconds ?? 0) * 1000))}`
      : state.error
        ? state.error
        : label
    renderLevels(state)

    clear(warnings)
    for (const warning of state.warnings ?? []) {
      warnings.append(el('li', { class: 'meeting-warning', text: warning }))
    }
    setHidden(warnings, (state.warnings ?? []).length === 0)

    privacy.textContent = snapshot.settings?.meetingCloudFallback
      ? 'Transcribed on this Mac. If no local model is running, the summary — and the transcript with it — goes to OpenRouter.'
      : 'Transcribed and summarised entirely on this Mac.'
  }

  return { root, update, focus: () => title.focus() }
}
