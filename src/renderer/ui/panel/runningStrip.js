import { el, setHidden } from '../dom.js'
import { formatElapsed } from '../format.js'

const TICK_MS = 1000

/**
 * The one thing worth showing on every view: a timer that is running right now. Slim by
 * design — the full timer lives in its own tab, and a clock you cannot see is a clock you
 * forget to stop.
 */
export const createRunningStrip = ({ onStop, onOpenTime }) => {
  const clock = el('span', { class: 'running-clock', text: '00:00' })
  const label = el('span', { class: 'running-label' })

  const root = el('button', {
    class: 'running-strip',
    type: 'button',
    title: 'Open the time tab',
    onclick: onOpenTime,
  }, [
    el('span', { class: 'rec-dot rec-dot--time' }),
    clock,
    label,
    el('span', {
      class: 'running-stop',
      role: 'button',
      title: 'Stop and log',
      text: 'Stop',
      onclick: (event) => (event.stopPropagation(), onStop()),
    }),
  ])

  let startedAt = null
  const tick = () => {
    if (startedAt === null) return
    clock.textContent = formatElapsed(Date.now() - startedAt)
  }
  setInterval(tick, TICK_MS)

  const update = ({ timer }) => {
    setHidden(root, !timer)
    startedAt = timer ? timer.startedAt : null
    if (!timer) return
    label.textContent = timer.binding?.label ?? timer.task
    tick()
  }

  return { root, update }
}
