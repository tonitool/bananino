import { el } from '../ui/dom.js'

/*
 * The Mac-settings vocabulary: inset-grouped cards, rows with the label on the left and
 * the control on the right, a switch that slides, a segmented control that pops. Shared by
 * every pane so the window reads as one app, not five dialogs.
 */

/** An inset-grouped card: the white-ish slab with hairline separators between rows. */
export const group = (...rows) => el('div', { class: 'group' }, rows.filter(Boolean))

/** One row: title left, control right, an optional line of quiet explanation under it. */
export const row = ({ label, description, control }) =>
  el('div', { class: 'row' }, [
    el('div', { class: 'row-copy' }, [
      el('span', { class: 'row-title', text: label }),
      description ? el('span', { class: 'row-desc', text: description }) : null,
    ]),
    control,
  ])

/** A block row for things that are not label-control pairs (cards, swatch grids). */
export const blockRow = (content) => el('div', { class: 'row row--block' }, [content])

/**
 * The macOS switch. `set` repaints it from the next snapshot so the switch always tells
 * the truth even when the change happened from the menu bar instead of this window.
 */
export const toggle = ({ label, onChange }) => {
  let on = false
  const knob = el('span', { class: 'toggle-knob', 'aria-hidden': 'true' })
  const button = el('button', {
    class: 'toggle',
    type: 'button',
    role: 'switch',
    'aria-checked': 'false',
    'aria-label': label,
    onclick: () => onChange(!on),
  }, [knob])
  return {
    root: button,
    set: (next) => {
      on = Boolean(next)
      button.setAttribute('aria-checked', String(on))
    },
  }
}

/** Small / Medium / Large and friends: the macOS segmented control. */
export const segmented = ({ options, onChange, label }) => {
  let selected = null
  const buttons = new Map(
    options.map(([id, text]) => [
      id,
      el('button', {
        class: 'segment',
        type: 'button',
        role: 'radio',
        'aria-checked': 'false',
        text,
        onclick: () => onChange(id),
      }),
    ]),
  )
  const rootEl = el('div', { class: 'segmented', role: 'radiogroup', 'aria-label': label }, [
    ...buttons.values(),
  ])
  return {
    root: rootEl,
    set: (next) => {
      selected = next
      for (const [id, button] of buttons) {
        button.setAttribute('aria-checked', String(id === selected))
      }
    },
  }
}

/** A quiet text button, macOS style. `primary` fills it with the butter gradient. */
export const button = ({ text, onclick, primary = false }) =>
  el('button', {
    class: primary ? 'btn btn--primary' : 'btn',
    type: 'button',
    text,
    onclick,
  })
