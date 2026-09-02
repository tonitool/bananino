import { el, clear, setHidden } from '../dom.js'
import { MIN_QUERY, matchTasks, renderTaskRows } from './taskSearch.js'
import { formatElapsed, formatMinutes } from '../format.js'

const TICK_MS = 1000

/**
 * The fastest path to a logged hour: one tap on a recent task, or type a new one and
 * press Enter. When something is running this becomes a live clock with a stop button.
 */
export const createTimerStrip = ({ onStart, onStop, onDescribe, onNudge }) => {
  const clock = el('span', { class: 'timer-clock', text: '00:00' })
  const task = el('span', { class: 'timer-task' })
  const stopButton = el('button', {
    class: 'button button--stop',
    type: 'button',
    onclick: onStop,
    text: 'Stop',
  })

  /** MOCO records what you did, separately from which task it books to. */
  const description = el('input', {
    class: 'timer-description',
    type: 'text',
    placeholder: 'What are you doing? (MOCO description)',
    'aria-label': 'Activity description for MOCO',
    autocomplete: 'off',
  })

  let describeTimer = null
  description.addEventListener('input', () => {
    // Debounced: this writes to settings, and one write per keystroke is wasteful.
    clearTimeout(describeTimer)
    describeTimer = setTimeout(() => onDescribe(description.value), 400)
  })

  /** Labelled as testing because it inflates a duration that becomes a billable record. */
  const nudgeButton = el('button', {
    class: 'chip chip--nudge',
    type: 'button',
    title: 'Add 5 minutes — for testing durations and rounding',
    text: '+5m',
    onclick: () => onNudge(5),
  })

  const running = el('div', { class: 'timer-running-view' }, [
    el('div', { class: 'timer-running' }, [
      el('div', { class: 'timer-readout' }, [clock, task]),
      nudgeButton,
      stopButton,
    ]),
    description,
  ])

  const input = el('input', {
    class: 'timer-input',
    type: 'text',
    placeholder: 'What are you working on?',
    'aria-label': 'Task name',
    autocomplete: 'off',
    spellcheck: 'false',
  })

  const chips = el('div', { class: 'chips' })
  const results = el('ul', { class: 'suggestions', 'aria-label': 'MOCO tasks' })

  /**
   * Filled in after a project is chosen and before the clock starts, which is the order
   * MOCO wants it in — the description belongs to the whole stint, not the tail of it.
   */
  const detail = el('input', {
    class: 'timer-detail',
    type: 'text',
    placeholder: 'What will you do? (optional)',
    'aria-label': 'Activity description for MOCO',
    autocomplete: 'off',
    hidden: true,
  })

  const startButton = el('button', {
    class: 'button button--start',
    type: 'button',
    text: 'Start',
    onclick: () => submit(),
  })

  const idle = el('div', { class: 'timer-idle' }, [
    el('div', { class: 'timer-entry' }, [input, startButton]),
    detail,
    chips,
    results,
  ])

  const root = el('section', { class: 'timer', 'aria-label': 'Time tracking' }, [running, idle])

  let startedAt = null
  let allTasks = []
  let bindings = {}
  let mocoTasks = []

  let pending = null

  /** Chosen, not started: the description is asked for first. */
  const choose = (suggestion) => {
    pending = suggestion
    input.value = suggestion.name
    clear(results)
    setHidden(detail, false)
    detail.focus()
  }

  const submit = () => {
    const chosen = pending ?? topSuggestion() ?? { name: input.value.trim(), binding: null }
    if (!chosen.name) return input.focus()

    const description = detail.value
    input.value = ''
    detail.value = ''
    pending = null
    setHidden(detail, true)
    onStart(chosen.name, chosen.binding, description)
  }

  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      // First Enter picks the top match; the second starts it. Typed-only names start now.
      const top = pending ? null : topSuggestion()
      if (top?.binding) choose(top)
      else submit()
    }
    if (event.key === 'Escape' && input.value) {
      event.stopPropagation()
      input.value = ''
      pending = null
      setHidden(detail, true)
      renderChips()
    }
  })

  input.addEventListener('input', () => {
    // Typing after choosing means the choice no longer stands.
    if (pending && input.value !== pending.name) {
      pending = null
      setHidden(detail, true)
    }
    renderChips()
  })

  detail.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') (event.preventDefault(), submit())
    if (event.key === 'Escape') (event.stopPropagation(), setHidden(detail, true), input.focus())
  })

  const words = (text) => text.toLowerCase().split(/\s+/).filter(Boolean)

  function recentSuggestions() {
    const terms = words(input.value)
    return allTasks
      .filter((name) => terms.every((term) => name.toLowerCase().includes(term)))
      .map((name) => ({ name, binding: bindings[name] ?? null, source: 'recent' }))
      .slice(0, 3)
  }

  /** MOCO tasks only appear once something has been typed — see taskSearch.js. */
  function mocoSuggestions() {
    // Named by project and role together: the same role appears under several projects,
    // and resuming a recent task must never book to the wrong one.
    return matchTasks(mocoTasks, input.value).map((entry) => ({
      name: entry.label,
      binding: entry,
      source: 'moco',
    }))
  }

  function suggestions() {
    return [...recentSuggestions(), ...mocoSuggestions()]
  }

  function topSuggestion() {
    const [first] = suggestions()
    if (!first) return undefined
    // A typed name that is not an exact match starts as itself, not as the nearest hit.
    const typed = input.value.trim().toLowerCase()
    if (!typed) return undefined
    return first.name.toLowerCase() === typed || suggestions().length === 1 ? first : undefined
  }

  function renderChips() {
    clear(chips)
    for (const suggestion of recentSuggestions()) {
      chips.append(
        el('button', {
          class: 'chip',
          type: 'button',
          // Marked so it is obvious at a glance which chips will reach MOCO.
          dataset: { source: suggestion.binding ? 'moco' : 'local' },
          title: suggestion.binding
            ? `Start “${suggestion.binding.label}”`
            : `Start “${suggestion.name}” (local only)`,
          text: suggestion.name,
          onclick: () => choose(suggestion),
        }),
      )
    }

    renderTaskRows({
      list: results,
      matches: matchTasks(mocoTasks, input.value),
      query: input.value,
      hasCatalogue: mocoTasks.length > 0,
      onPick: (entry) => choose({ name: entry.label, binding: entry, source: 'moco' }),
    })
  }

  const tick = () => {
    if (startedAt === null) return
    clock.textContent = formatElapsed(Date.now() - startedAt)
  }

  setInterval(tick, TICK_MS)

  const setMocoTasks = (tasks) => {
    mocoTasks = Array.isArray(tasks) ? tasks : []
    if (root.dataset.state !== 'running') renderChips()
  }

  void MIN_QUERY

  const update = ({ timer, recentTasks, today, bindings: taskBindings }) => {
    allTasks = recentTasks
    bindings = taskBindings ?? {}
    startedAt = timer ? timer.startedAt : null

    root.dataset.state = timer ? 'running' : 'idle'
    if (timer) {
      task.textContent = timer.binding?.label ?? timer.task
      stopButton.title = `Stop and log “${timer.task}”`
      // Not overwritten while being typed into, or it would fight the debounce.
      if (document.activeElement !== description) description.value = timer.description ?? ''
      tick()
    } else {
      description.value = ''
      renderChips()
    }

    root.dataset.today = formatMinutes(today.minutes)
  }

  return { root, update, setMocoTasks, focus: () => input.focus() }
}
