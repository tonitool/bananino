import { el } from '../dom.js'
import { CHARACTERS } from '../../scene/characters.js'
import { COSTUMES } from '../../scene/costumes.js'
import { SHIRTS } from '../../scene/shirts.js'
import { LOOKS } from '../../scene/looks.js'

/**
 * Everything about how the buddy looks, in one place: who it is, what it is wearing and
 * whether it is dancing. Opened from the right-click menu rather than a tab, so it has to
 * carry its own title and its own way out.
 *
 * The character is the reason this view exists — swapping the model means fetching and
 * measuring megabytes of mesh, so the card that was pressed says it is working rather
 * than sitting there looking ignored.
 */
export const createSettingsTab = ({ onCharacter, onCostume, onShirt, onLook, onDance, onClose }) => {
  let current = null
  let pending = null
  let costume = 'none'
  let shirt = 'none'
  let canWearShirt = false
  let look = 'cream'
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

  /*
   * Named rather than emoji, unlike the costumes: these are collaborations, and a brand's
   * shirt is picked by its name.
   */
  const shirtButtons = new Map(
    Object.entries(SHIRTS).map(([id, { label }]) => [
      id,
      el('button', {
        class: 'chip chip--shirt',
        type: 'button',
        text: label,
        onclick: () => onShirt(id),
      }),
    ]),
  )

  /*
   * Title and chips together, so the pair disappears as one when the character on stage
   * has no shirt to wear — a heading over an empty gap reads as something broken.
   */
  const shirtSection = el('div', { class: 'shirt-section' }, [
    el('p', { class: 'section-title', text: 'Shirt' }),
    el('div', { class: 'costume-row', role: 'group', 'aria-label': 'Shirt' }, [
      ...shirtButtons.values(),
    ]),
  ])

  /*
   * The wardrobe. A swatch rather than a name, because what you are choosing is a colour
   * and a weave — and because ten names would not fit a 348px panel.
   */
  const lookButtons = new Map(
    Object.entries(LOOKS).map(([id, entry]) => [
      id,
      el('button', {
        class: 'chip chip--look',
        type: 'button',
        title: entry.label,
        'aria-label': entry.label,
        vars: {
          '--look': entry.color,
          '--look-accent': entry.accent ?? entry.brim ?? entry.color,
        },
        dataset: { pattern: entry.pattern ?? 'plain' },
        onclick: () => onLook(id),
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
    el('p', { class: 'section-title', text: 'Look' }),
    el('div', { class: 'look-row', role: 'group', 'aria-label': 'Look' }, [
      ...lookButtons.values(),
    ]),
    el('p', { class: 'section-title', text: 'Costume' }),
    el('div', { class: 'costume-row', role: 'group', 'aria-label': 'Costume' }, [
      ...costumeButtons.values(),
    ]),
    shirtSection,
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

    for (const [id, button] of shirtButtons) {
      button.setAttribute('aria-pressed', String(id === shirt))
    }

    for (const [id, button] of lookButtons) {
      button.setAttribute('aria-pressed', String(id === look))
    }

    shirtSection.hidden = !canWearShirt

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
    shirt = snapshot.shirt ?? 'none'
    canWearShirt = snapshot.canWearShirt === true
    look = snapshot.look ?? look
    dance = snapshot.dance ?? null
    paint()
  }

  paint()

  return { root, update, focus: () => cards.get(current)?.focus() }
}
