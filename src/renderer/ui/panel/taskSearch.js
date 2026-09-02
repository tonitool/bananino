import { el, clear } from '../dom.js'

/** Two characters, so a 123-task catalogue is never dumped into the panel at once. */
export const MIN_QUERY = 2
const MAX_RESULTS = 6

const words = (text) => String(text ?? '').toLowerCase().split(/\s+/).filter(Boolean)

/** Every word must appear somewhere, so "berat selbst" narrows without needing an order. */
export const matchTasks = (mocoTasks, query, limit = MAX_RESULTS) => {
  const text = String(query ?? '').trim()
  if (text.length < MIN_QUERY) return []

  const terms = words(text)
  return mocoTasks
    .filter((entry) => terms.every((term) => `${entry.label} ${entry.customer}`.toLowerCase().includes(term)))
    .slice(0, limit)
}

/**
 * Project on the first line, role and customer beneath. Several projects here share a
 * role name, so the role alone cannot identify an entry.
 */
export const renderTaskRows = ({ list, matches, query, hasCatalogue, onPick }) => {
  clear(list)

  if (String(query ?? '').trim().length >= MIN_QUERY && matches.length === 0 && hasCatalogue) {
    list.append(
      el('li', { class: 'suggestion-empty', text: 'No MOCO task matches — it will stay local.' }),
    )
    return
  }

  for (const entry of matches) {
    list.append(
      el('li', {}, [
        el('button', {
          class: 'suggestion',
          type: 'button',
          title: `${entry.task} on ${entry.project}`,
          onclick: () => onPick(entry),
        }, [
          el('span', { class: 'suggestion-task', text: entry.project }),
          el('span', {
            class: 'suggestion-project',
            text: [entry.task, entry.customer, entry.billable ? null : 'non-billable']
              .filter(Boolean)
              .join(' · '),
          }),
        ]),
      ]),
    )
  }
}
