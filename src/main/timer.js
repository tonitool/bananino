import { appendTimeEntry, normaliseTask } from './storage/timeLog.js'

/** Under this, the timer was started and stopped by accident, not worked. */
const MIN_LOGGABLE_SECONDS = 30
import { withBinding, withRecentTask } from './store.js'
import { nudgedStart } from './timerMath.js'

/**
 * A single running timer, persisted in settings so an unexpected quit does not lose the
 * session that was in flight. Every transition returns the updated settings, keeping the
 * caller's state and the file on disk in step.
 */
export const createTimer = ({ getSettings, saveSettings, onChange }) => {
  const active = () => getSettings().activeTimer

  /** `binding` names the MOCO project/task this stint belongs to, when there is one. */
  const start = async (rawTask, binding = null, description = '') => {
    if (active()) await stop()

    const task = normaliseTask(rawTask)
    const settings = getSettings()
    // A task remembers where it books to, so resuming it later needs no second choice.
    const bindings = withBinding(settings.taskBindings, task, binding)

    saveSettings({
      activeTimer: { task, startedAt: Date.now(), binding: bindings[task] ?? null, description },
      recentTasks: withRecentTask(settings.recentTasks, task),
      taskBindings: bindings,
    })

    onChange?.({ type: 'started', task, binding: bindings[task] ?? null })
    return { task }
  }

  const stop = async () => {
    const running = active()
    if (!running) return null

    const startedAt = new Date(running.startedAt)
    const endedAt = new Date()
    const seconds = (endedAt - startedAt) / 1000

    if (seconds < MIN_LOGGABLE_SECONDS) {
      saveSettings({ activeTimer: null })
      onChange?.({ type: 'discarded', task: running.task, seconds })
      return { type: 'discarded', task: running.task, seconds }
    }

    try {
      const { minutes } = await appendTimeEntry({
        dataDir: getSettings().dataDir,
        task: running.task,
        startedAt,
        endedAt,
      })
      saveSettings({ activeTimer: null })
      const stopped = {
        type: 'stopped',
        task: running.task,
        minutes,
        startedAt: running.startedAt,
        endedAt: endedAt.getTime(),
        binding: running.binding ?? getSettings().taskBindings[running.task] ?? null,
        description: running.description ?? '',
      }
      onChange?.(stopped)
      return stopped
    } catch (error) {
      // The timer keeps running rather than silently losing the elapsed time.
      console.error('[timer] could not write the entry:', error)
      onChange?.({ type: 'error', message: 'Could not save that entry — check the folder.' })
      throw error
    }
  }

  const toggle = async (task, binding) => (active() ? stop() : start(task ?? lastTask(), binding))

  const lastTask = () => getSettings().recentTasks[0] ?? ''

  /** Shifts the running timer's elapsed time, for testing durations and rounding. */
  const nudge = (minutes) => {
    const running = active()
    if (!running) return null

    const startedAt = nudgedStart(running.startedAt, minutes, Date.now())
    saveSettings({ activeTimer: { ...running, startedAt } })
    onChange?.({ type: 'nudged', minutes, elapsedMs: Date.now() - startedAt })
    return startedAt
  }

  /** MOCO expects a description of the activity, separate from which task it books to. */
  const describe = (description) => {
    const running = active()
    if (!running) return
    saveSettings({ activeTimer: { ...running, description } })
  }

  return { start, stop, toggle, describe, nudge, active, lastTask }
}
