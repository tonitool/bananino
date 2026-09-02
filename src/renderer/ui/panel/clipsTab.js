import { el, clear } from '../dom.js'
import { formatRelative, oneLine } from '../format.js'

const MAX_VISIBLE = 40

/** Clipboard history: click to copy back, pin the ones worth keeping. */
export const createClipsTab = ({ onCopy, onPin, onDelete, onClear }) => {
  const search = el('input', {
    class: 'clip-search',
    type: 'search',
    placeholder: 'Search clips…',
    'aria-label': 'Search clipboard history',
    autocomplete: 'off',
  })

  const list = el('ul', { class: 'clips', 'aria-label': 'Clipboard history' })

  const clearButton = el('button', {
    class: 'button button--quiet',
    type: 'button',
    text: 'Clear unpinned',
    onclick: onClear,
  })

  const root = el('section', { class: 'tab-panel', id: 'tab-clips', role: 'tabpanel' }, [
    search,
    list,
    el('div', { class: 'row row--end' }, [clearButton]),
  ])

  let clips = []
  search.addEventListener('input', render)
  search.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && search.value) (event.stopPropagation(), (search.value = ''), render())
  })

  function visible() {
    const query = search.value.trim().toLowerCase()
    const matching = query
      ? clips.filter((clip) => clip.preview.toLowerCase().includes(query))
      : clips
    // Pinned first, then most recent, so the useful ones never scroll away.
    return [...matching]
      .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.at - a.at)
      .slice(0, MAX_VISIBLE)
  }

  function render() {
    clear(list)
    const items = visible()

    if (items.length === 0) {
      list.append(
        el('li', {
          class: 'empty',
          text: clips.length === 0 ? 'Copy something and it shows up here.' : 'No matches.',
        }),
      )
      return
    }

    for (const clip of items) list.append(renderClip(clip))
  }

  function renderClip(clip) {
    const truncated = clip.length > clip.preview.length
    return el('li', { class: 'clip', dataset: { pinned: String(clip.pinned) } }, [
      el('button', {
        class: 'clip-body',
        type: 'button',
        title: 'Copy back to the clipboard',
        onclick: () => onCopy(clip.id),
      }, [
        el('span', { class: 'clip-text', text: oneLine(clip.preview) + (truncated ? '…' : '') }),
        el('span', { class: 'clip-meta', text: formatRelative(clip.at) }),
      ]),
      el('button', {
        class: 'icon-button',
        type: 'button',
        title: clip.pinned ? 'Unpin' : 'Pin',
        'aria-label': clip.pinned ? 'Unpin clip' : 'Pin clip',
        text: clip.pinned ? '★' : '☆',
        onclick: () => onPin(clip.id),
      }),
      el('button', {
        class: 'icon-button',
        type: 'button',
        title: 'Forget this clip',
        'aria-label': 'Delete clip',
        text: '×',
        onclick: () => onDelete(clip.id),
      }),
    ])
  }

  const update = (snapshot) => {
    clips = snapshot.clips
    clearButton.disabled = clips.every((clip) => clip.pinned)
    render()
  }

  return { root, update, focus: () => search.focus() }
}
