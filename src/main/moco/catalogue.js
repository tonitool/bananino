/**
 * Flattens MOCO's assigned-projects response into one searchable list of bookable tasks,
 * so the timer's type-ahead can suggest real entries instead of free text.
 */
export const flattenProjects = (projects) => {
  if (!Array.isArray(projects)) return []

  return projects.flatMap((project) =>
    (project?.tasks ?? []).map((task) =>
      relabel({
        projectId: project.id,
        taskId: task.id,
        customer: project.customer?.name ?? '',
        project: project.name ?? '',
        task: task.name ?? '',
        billable: task.billable !== false,
      }),
    ),
  )
}

/**
 * Labels are derived, never trusted from storage. A cached catalogue written by an older
 * build still holds that build's label format, which then shows up in fresh entries.
 */
export const relabel = (entry) => ({
  ...entry,
  // Project first, then role — the order MOCO itself asks for.
  label: [entry.project, entry.task].filter(Boolean).join(' — '),
  detail: [entry.customer, entry.task].filter(Boolean).join(' · '),
})

/**
 * Every query word must appear somewhere in the label, so "onb design" finds
 * "Acme · Onboarding · Design" without needing the words in order.
 */
export const searchTasks = (entries, query, limit = 6) => {
  const words = String(query ?? '')
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)

  if (words.length === 0) return entries.slice(0, limit)

  return entries
    .map((entry) => ({ entry, haystack: entry.label.toLowerCase() }))
    .filter(({ haystack }) => words.every((word) => haystack.includes(word)))
    .map(({ entry, haystack }) => ({
      entry,
      // Prefer matches on the task itself over ones buried in the customer name.
      score: haystack.indexOf(words[0]) + (entry.task.toLowerCase().startsWith(words[0]) ? -50 : 0),
    }))
    .sort((a, b) => a.score - b.score)
    .slice(0, limit)
    .map(({ entry }) => entry)
}

export const findBinding = (entries, { projectId, taskId }) =>
  entries.find((entry) => entry.projectId === projectId && entry.taskId === taskId) ?? null
