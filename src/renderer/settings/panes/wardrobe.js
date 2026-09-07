import { el } from '../../ui/dom.js'
import { group, row, blockRow, toggle } from '../controls.js'
import { CHARACTERS } from '../../scene/characters.js'
import { LOOKS } from '../../scene/looks.js'
import { COSTUMES } from '../../scene/costumes.js'
import { SHIRTS } from '../../scene/shirts.js'
import { randomDance } from '../../animation/dances.js'
import { COSTUME_MENU } from '../../../main/constants.js'

/**
 * What the buddy is wearing. A look is the cloth — one pick dresses cap and shirt as a
 * pair — so swatches get the big grid and the fabric they describe, while headwear stays
 * a row of glyphs.
 *
 * Headwear comes from COSTUME_MENU, the same list the settings file validates against —
 * the registry has a `cap` entry too, but it is not a pickable costume today and offering
 * it would silently discard the choice on save.
 */
export const createWardrobePane = ({ setLook, setCostume, setShirt, setDance }) => {
  const swatches = new Map(
    Object.entries(LOOKS).map(([id, look]) => [
      id,
      el(
        'button',
        {
          class: 'swatch',
          type: 'button',
          role: 'radio',
          'aria-checked': 'false',
          'aria-label': look.label,
          vars: { '--look': look.color, '--look-accent': look.accent ?? look.brim ?? look.color },
          dataset: { pattern: look.pattern ?? 'plain' },
          onclick: () => setLook(id),
        },
        [
          el('span', { class: 'swatch-cloth', 'aria-hidden': 'true' }),
          el('span', { class: 'swatch-name', text: look.label }),
        ],
      ),
    ]),
  )

  const costumeChips = new Map(
    COSTUME_MENU.map(([name, label]) => [
      name,
      el('button', {
        class: 'wchip',
        type: 'button',
        role: 'radio',
        'aria-checked': 'false',
        'aria-label': label,
        title: label,
        text: COSTUMES[name]?.emoji ?? '❔',
        onclick: () => setCostume(name),
      }),
    ]),
  )

  const shirtChips = new Map(
    Object.entries(SHIRTS).map(([id, shirt]) => [
      id,
      el('button', {
        class: 'wchip wchip--word',
        type: 'button',
        role: 'radio',
        'aria-checked': 'false',
        text: shirt.label,
        onclick: () => setShirt(id),
      }),
    ]),
  )

  const shirtRow = row({
    label: 'Shirt',
    description: 'Cut for the banana — it steps aside for a body it cannot fit.',
    control: el('div', { class: 'wchip-row' }, [...shirtChips.values()]),
  })

  /*
   * The dance lives in the 3D scene, so this window never learns when it ends — the
   * toggle is optimistic and simply offers the way in and the way out.
   */
  let lastDance = null
  const danceToggle = toggle({
    label: 'Dancing',
    onChange: (next) => {
      lastDance = next ? randomDance(lastDance) : lastDance
      danceToggle.set(next)
      setDance(next ? lastDance : null)
    },
  })

  const root = el('div', { class: 'pane-body' }, [
    blockRow(el('div', { class: 'swatch-grid', role: 'radiogroup', 'aria-label': 'Look' }, [
      ...swatches.values(),
    ])),
    el('p', {
      class: 'footnote',
      text: 'One look dresses the cap and the shirt together — pick a cloth, not two settings.',
    }),
    group(
      row({
        label: 'Headwear',
        control: el('div', { class: 'wchip-row' }, [...costumeChips.values()]),
      }),
    ),
    group(
      shirtRow,
      row({ label: 'Dancing', description: 'The buddy takes a little spin on the desktop.', control: danceToggle.root }),
    ),
  ])

  const update = (snapshot) => {
    const settings = snapshot.settings ?? {}
    for (const [id, swatch] of swatches) swatch.setAttribute('aria-checked', String(id === settings.look))
    for (const [name, chip] of costumeChips) chip.setAttribute('aria-checked', String(name === settings.costume))
    for (const [id, chip] of shirtChips) chip.setAttribute('aria-checked', String(id === settings.shirt))
    shirtRow.hidden = !CHARACTERS[settings.character ?? 'banana']?.shirt
  }

  return { root, update }
}
