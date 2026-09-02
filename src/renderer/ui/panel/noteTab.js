import { el, clear } from '../dom.js'

/** Notes are one keystroke away: type, press ⌘↵, and it lands in today's Markdown file. */
export const createNoteTab = ({ onSave, onMenu, onDelete }) => {
  const input = el('textarea', {
    class: 'note-input',
    placeholder: 'Jot something down…',
    'aria-label': 'New note',
    rows: '4',
  })

  const saveButton = el('button', {
    class: 'button button--primary',
    type: 'button',
    text: 'Save note',
    onclick: () => submit(),
  })

  const recent = el('ul', { class: 'recent', 'aria-label': "Today's notes" })

  const root = el('section', { class: 'tab-panel', id: 'tab-note', role: 'tabpanel' }, [
    input,
    el('div', { class: 'row' }, [
      el('span', { class: 'hint', text: '⌘↵ to save' }),
      saveButton,
    ]),
    el('h2', { class: 'section-title', text: 'Earlier today' }),
    el('p', { class: 'hint', text: 'Right-click a note to copy, delete, or ask an assistant' }),
    recent,
  ])

  const submit = () => {
    const text = input.value.trim()
    if (!text) return input.focus()
    onSave(text)
  }

  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault()
      submit()
    }
  })

  const update = ({ recentNotes }) => {
    clear(recent)
    if (recentNotes.length === 0) {
      recent.append(el('li', { class: 'empty', text: 'Nothing yet today.' }))
      return
    }
    for (const note of recentNotes) {
      recent.append(
        el('li', {
          class: 'recent-item',
          // Right-click carries copy, delete and the hand-off to an assistant, so the row
          // stays a row rather than a strip of buttons.
          oncontextmenu: (event) => (event.preventDefault(), onMenu(note.index)),
        }, [
          el('time', { class: 'recent-time', text: note.time }),
          el('p', { class: 'recent-text', text: note.preview }),
          el('button', {
            class: 'icon-button',
            type: 'button',
            title: 'Delete this note',
            'aria-label': 'Delete note',
            text: '×',
            onclick: () => onDelete(note.index),
          }),
        ]),
      )
    }
  }

  return { root, update, focus: () => input.focus(), clearInput: () => (input.value = '') }
}
