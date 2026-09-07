import { el, svgIcon } from '../ui/dom.js'

/*
 * The window's frame: a System Settings sidebar on the left — coloured icon chip, one word
 * each — and a headered content column on the right. One pane at a time; switching is a
 * selection change, not a navigation.
 */

/* Stroked 24x24 glyphs in the sidebar's colourful chips, as System Settings draws them. */
const ICONS = {
  buddy: [
    ['circle', { cx: '12', cy: '12', r: '8.2' }],
    ['circle', { cx: '8.8', cy: '10.2', r: '0.4', fill: 'currentColor' }],
    ['circle', { cx: '15.2', cy: '10.2', r: '0.4', fill: 'currentColor' }],
    ['path', { d: 'M8.6 14.2c.9 1.1 2 1.7 3.4 1.7s2.5-.6 3.4-1.7' }],
  ],
  wardrobe: [
    ['path', { d: 'M9 4.5 4.8 7.2l1.6 2.8 1.7-1V19h10v-10l1.7 1 1.6-2.8L15 4.5c-.5 1.1-1.6 1.8-3 1.8s-2.5-.7-3-1.8Z' }],
  ],
  behaviour: [
    ['path', { d: 'M4 7.5h8M4 12h4M4 16.5h10' }],
    ['circle', { cx: '15', cy: '7.5', r: '2.2' }],
    ['circle', { cx: '10.5', cy: '12', r: '2.2' }],
    ['circle', { cx: '17', cy: '16.5', r: '2.2' }],
  ],
  files: [
    ['path', { d: 'M4 7.2c0-.8.7-1.5 1.5-1.5h3.9l2 2.2h7.1c.8 0 1.5.7 1.5 1.5v7.3c0 .8-.7 1.5-1.5 1.5h-13c-.8 0-1.5-.7-1.5-1.5V7.2Z' }],
  ],
  about: [
    ['circle', { cx: '12', cy: '12', r: '8.2' }],
    ['path', { d: 'M12 11v5' }],
    ['circle', { cx: '12', cy: '8', r: '0.4', fill: 'currentColor' }],
  ],
}

/**
 * @param sections `[{ id, label, blurb, tint, view }]` in sidebar order; `view` is the
 * pane object `{ root, update }`.
 */
export const createLayout = ({ sections }) => {
  const title = el('h1', { class: 'pane-title' })
  const blurb = el('p', { class: 'pane-blurb' })

  let active = sections[0].id

  const items = new Map(
    sections.map((section) => [
      section.id,
      el(
        'button',
        {
          class: 'nav-item',
          type: 'button',
          'aria-current': 'false',
          vars: { '--chip': section.tint },
          dataset: { pane: section.id },
          onclick: () => show(section.id),
        },
        [el('span', { class: 'nav-chip', 'aria-hidden': 'true' }, [svgIcon(ICONS[section.id] ?? ICONS.about)]), el('span', { class: 'nav-label', text: section.label })],
      ),
    ]),
  )

  const content = el('div', { class: 'pane' })

  function show(id) {
    if (!sections.some((section) => section.id === id)) return
    active = id
    const section = sections.find((s) => s.id === id)

    for (const [itemId, item] of items) item.setAttribute('aria-current', String(itemId === id))
    title.textContent = section.label
    blurb.textContent = section.blurb
    content.replaceChildren(section.view.root)
  }

  const root = el('div', { class: 'frame' }, [
    el('nav', { class: 'sidebar', 'aria-label': 'Settings' }, [
      el('div', { class: 'sidebar-brand' }, [
        el('img', { class: 'brand-icon', src: './icon.png', alt: '' }),
        el('span', { class: 'brand-name', text: 'Bananino' }),
      ]),
      el('div', { class: 'nav-list' }, [...items.values()]),
    ]),
    el('main', { class: 'content' }, [
      el('header', { class: 'pane-head' }, [title, blurb]),
      content,
    ]),
  ])

  show(active)

  return { root, show }
}
