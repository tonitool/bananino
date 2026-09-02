import { el } from '../dom.js'
import { CHARACTERS } from '../../scene/characters.js'
import { COSTUMES } from '../../scene/costumes.js'

/**
 * Everything about how the buddy looks, in one place: who it is, what it is wearing and
 * whether it is dancing. Opened from the right-click menu rather than a tab, so it has to
 * carry its own title and its own way out.
 *
 * The character is the reason this view exists — swapping the model means fetching and
 * measuring megabytes of mesh, so the card that was pressed says it is working rather
 * than sitting there looking ignored.
 */
export const createSettingsTab = ({ onCharacter, onCostume, onDance, onClose }) => {
  let current = null
  let pending = null
  let costume = 'none'
  let dance = null

  const marks = new Map()

  const cards = new Map(
    Object.entries(CHARACTERS).map(([id, character]) => {
      const mark = el('span', { class: 'character-mark', 'aria-hidden': 'true' })
      marks.set(id, mark)

      return [
        id,
        el(
          'button',
          {
            class: 'character-card',
            type: 'button',
            onclick: () => {
              if (id === current) return
              // Pressing another card mid-swap is a change of mind, not an error: the
              // last press wins, and the loader it beats is discarded. The spinner comes
              // back with the repaint, so nothing is guessed at here.
              onCharacter(id)
            },
          },
          [
            el('span', { class: 'character-name', text: character.label }, [mark]),
            el('span', { class: 'character-blurb', text: character.blurb }),
          ],
        ),
      ]
    }),
  )

  const costumeButtons = new Map(
    Object.entries(COSTUMES).map(([name, { label, emoji }]) => [
      name,
      el('button', {
        class: 'chip chip--costume',
        type: 'button',
        title: label,
        'aria-label': label,
        text: emoji,
        onclick: () => onCostume(name),
      }),
    ]),
  )

  const danceButton = el('button', {
    class: 'button button--quiet',
    type: 'button',
    onclick: onDance,
  })

  const root = el('section', { class: 'tab-panel', id: 'tab-settings', role: 'group', 'aria-label': 'Settings' }, [
    el('div', { class: 'settings-head' }, [
      el('h2', { class: 'settings-title', text: 'Settings' }),
      el('button', { class: 'button button--quiet', type: 'button', text: 'Done', onclick: onClose }),
    ]),
    el('p', { class: 'section-title', text: 'Character' }),
    el('div', { class: 'character-picker', role: 'group', 'aria-label': 'Character' }, [
      ...cards.values(),
    ]),
    el('p', { class: 'section-title', text: 'Costume' }),
    el('div', { class: 'costume-row', role: 'group', 'aria-label': 'Costume' }, [
      ...costumeButtons.values(),
    ]),
    el('div', { class: 'row' }, [el('p', { class: 'section-title', text: 'Motion' }), danceButton]),
  ])

  function paint() {
    for (const [id, card] of cards) {
      const state = id === current ? 'on' : id === pending ? 'loading' : 'off'
      card.dataset.state = state
      card.setAttribute('aria-pressed', String(state === 'on'))
      marks.get(id).textContent = state === 'on' ? '✓' : state === 'loading' ? '…' : ''
    }

    for (const [name, button] of costumeButtons) {
      button.setAttribute('aria-pressed', String(name === costume))
    }

    danceButton.textContent = dance ? 'Stop dancing' : 'Dance'
  }

  /**
   * `character` is the model actually on stage and `wantedCharacter` the one being
   * fetched — never the saved setting, which changes the instant a card is pressed.
   * Ticking a card off that would claim a swap that has not happened yet, and a load that
   * fails would leave a card spinning for the rest of the session.
   */
  const update = (snapshot) => {
    current = snapshot.character ?? current
    pending = snapshot.wantedCharacter === current ? null : (snapshot.wantedCharacter ?? null)
    costume = snapshot.costume ?? 'none'
    dance = snapshot.dance ?? null
    paint()
  }

  paint()

  return { root, update, focus: () => cards.get(current)?.focus() }
}
