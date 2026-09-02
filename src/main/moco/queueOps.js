/** Pure queue operations, kept free of Electron so they can be tested directly. */

/** MOCO takes hours as a float. Never rounds a real stint down to nothing. */
export const toHours = (seconds) => Math.max(0.01, Math.round((seconds / 3600) * 100) / 100)

export const isEntry = (value) =>
  value !== null &&
  typeof value === 'object' &&
  typeof value.id === 'string' &&
  typeof value.date === 'string' &&
  Number.isFinite(value.projectId) &&
  Number.isFinite(value.taskId) &&
  Number.isFinite(value.hours)

/** The payload MOCO expects, kept separate from the bookkeeping fields around it. */
export const toActivity = (entry) => ({
  date: entry.date,
  project_id: entry.projectId,
  task_id: entry.taskId,
  hours: entry.hours,
  description: entry.description ?? '',
})

export const addEntry = (queue, entry) => [...queue, entry]

export const removeEntries = (queue, ids) => {
  const done = new Set(ids)
  return queue.filter((entry) => !done.has(entry.id))
}

export const markFailed = (queue, id, error) =>
  queue.map((entry) =>
    entry.id === id ? { ...entry, error, attempts: (entry.attempts ?? 0) + 1 } : entry,
  )
