import { el } from '../../ui/dom.js'
import { group, row, blockRow, segmented } from '../controls.js'
import { CHARACTERS } from '../../scene/characters.js'

const SIZES = [
  ['small', 'Small'],
  ['medium', 'Medium'],
  ['large', 'Large'],
]

/**
 * Who lives on the desktop. A card per body, picked by name and one honest line about
 * each, rather than by a silhouette the window cannot render. The swap itself plays out
 * on the desktop a moment after the click — the buddy morphing is the confirmation.
 */
export const createBuddyPane = ({ setCharacter, setSize }) => {
  const cards = new Map(
    Object.entries(CHARACTERS).map(([id, character]) => [
      id,
      el(
        'button',
        {
          class: 'body-card',
          type: 'button',
          role: 'radio',
          'aria-checked': 'false',
          onclick: () => setCharacter(id),
        },
        [
          el('span', { class: 'body-check', 'aria-hidden': 'true', text: '✓' }),
          el('span', { class: 'body-name', text: character.label }),
          el('span', { class: 'body-blurb', text: character.blurb }),
        ],
      ),
    ]),
  )

  const size = segmented({ label: 'Buddy size', options: SIZES, onChange: setSize })

  const root = el('div', { class: 'pane-body' }, [
    blockRow(
      el('div', { class: 'body-picker', role: 'radiogroup', 'aria-label': 'Character' }, [
        ...cards.values(),
      ]),
    ),
    group(row({ label: 'Size', description: 'How tall the buddy stands on your desktop.', control: size.root })),
    el('p', { class: 'footnote', text: 'Changes take a moment — the new body is fetched and fitted before it steps on stage.' }),
  ])

  const update = (snapshot) => {
    const current = snapshot.settings?.character ?? 'banana'
    for (const [id, card] of cards) card.setAttribute('aria-checked', String(id === current))
    if (snapshot.settings?.sizeKey) size.set(snapshot.settings.sizeKey)
  }

  return { root, update }
}
