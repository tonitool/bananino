import { el } from '../dom.js'
import { MIN_QUERY, matchTasks, renderTaskRows } from './taskSearch.js'

const pad = (n) => String(n).padStart(2, '0')

const isoDay = (offsetDays = 0) => {
  const day = new Date()
  day.setDate(day.getDate() + offsetDays)
  return `${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}`
}

/**
 * For the days the timer never got started. The duration is typed rather than measured,
 * so start and end times are deliberately not asked for — inventing them would put false
 * clock times in the log.
 */
export const createManualEntry = ({ onAdd }) => {
  const date = el('input', {
    class: 'manual-input manual-date',
    type: 'date',
    'aria-label': 'Date',
    value: isoDay(),
  })

  /**
   * Forgotten time is nearly always today or yesterday. The calendar is still there for
   * anything older, but it opens as an OS popup that the small window clips, so it is not
   * the primary way in.
   */
  const quickDates = el('div', { class: 'quick-dates' }, [
    ['Today', 0],
    ['Yesterday', -1],
  ].map(([label, offset]) =>
    el('button', {
      class: 'chip chip--date',
      type: 'button',
      text: label,
      onclick: () => {
        date.value = isoDay(offset)
        syncQuickDates()
      },
    }),
  ))

  function syncQuickDates() {
    const buttons = [...quickDates.children]
    buttons[0].setAttribute('aria-pressed', String(date.value === isoDay(0)))
    buttons[1].setAttribute('aria-pressed', String(date.value === isoDay(-1)))
  }

  date.addEventListener('change', syncQuickDates)

  const duration = el('input', {
    class: 'manual-input manual-duration',
    type: 'text',
    placeholder: '90m · 1,5h · 1:30',
    'aria-label': 'Duration',
    autocomplete: 'off',
  })

  const task = el('input', {
    class: 'manual-input',
    type: 'text',
    placeholder: 'Search a MOCO project…',
    'aria-label': 'Task',
    autocomplete: 'off',
  })

  const description = el('input', {
    class: 'manual-input',
    type: 'text',
    placeholder: 'What did you do? (MOCO description)',
    'aria-label': 'Description',
    autocomplete: 'off',
  })

  const results = el('ul', { class: 'suggestions suggestions--inline' })
  const error = el('p', { class: 'moco-error' })

  let mocoTasks = []
  let picked = null

  const submit = () => {
    error.textContent = ''
    if (!duration.value.trim()) {
      error.textContent = 'How long was it?'
      return duration.focus()
    }
    if (!task.value.trim() && !picked) {
      error.textContent = 'Which task?'
      return task.focus()
    }

    onAdd({
      date: date.value,
      duration: duration.value,
      task: picked ? picked.label : task.value,
      description: description.value,
      binding: picked,
    })
  }

  const addButton = el('button', {
    class: 'button button--primary button--small',
    type: 'button',
    text: 'Add',
    onclick: submit,
  })

  const root = el('div', { class: 'manual-form' }, [
    el('div', { class: 'manual-row' }, [quickDates, duration]),
    date,
    task,
    results,
    description,
    error,
    el('div', { class: 'row row--end' }, [addButton]),
  ])

  const renderResults = () => {
    renderTaskRows({
      list: results,
      matches: matchTasks(mocoTasks, task.value),
      query: task.value,
      hasCatalogue: mocoTasks.length > 0,
      onPick: (entry) => {
        picked = entry
        task.value = entry.label
        renderResults()
      },
    })
  }

  task.addEventListener('input', () => {
    // Typing after choosing means the choice no longer stands.
    picked = null
    renderResults()
  })

  for (const field of [duration, task, description]) {
    field.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') (event.preventDefault(), submit())
      if (event.key === 'Escape') (event.stopPropagation(), setOpen(false))
    })
  }

  const setMocoTasks = (tasks) => {
    mocoTasks = Array.isArray(tasks) ? tasks : []
    if (task.value.trim().length >= MIN_QUERY) renderResults()
  }

  const reset = () => {
    duration.value = ''
    task.value = ''
    description.value = ''
    error.textContent = ''
    picked = null
    date.value = isoDay()
    syncQuickDates()
    renderResults()
  }

  syncQuickDates()

  return { root, setMocoTasks, reset, focus: () => duration.focus() }
}
