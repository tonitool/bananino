import { el } from '../ui/dom.js'
import { fromKeyboardEvent } from '../../main/accelerators.js'

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

/**
 * A shortcut recorder: shows the chord, and on click listens for the next one.
 *
 * Keys are read while it is listening and *only* then, on the capture phase with the event
 * swallowed — otherwise recording ⌘W would close this window instead of being recorded,
 * which is a memorable way to lose a settings pane.
 *
 * `esc` leaves it alone, `delete` switches the shortcut off. Both are printed in the
 * placeholder, because a control that only works if you already know how is not a control.
 */
export const recorder = ({ onChange, describe, onRecording = () => {} }) => {
  let listening = false
  let current = ''

  const label = el('span', { class: 'rec-keys' })
  const root = el('button', {
    class: 'rec',
    type: 'button',
    'aria-label': 'Change this shortcut',
    onclick: () => (listening ? stop() : start()),
  }, [label])

  const paint = () => {
    root.dataset.listening = String(listening)
    root.dataset.off = String(!listening && !current)
    label.textContent = listening ? 'Press keys · esc, ⌫ off' : describe(current) || 'Off'
  }

  const onKeyDown = (event) => {
    if (!listening) return
    // Nothing typed while recording belongs to anything else on the page.
    event.preventDefault()
    event.stopPropagation()

    if (event.key === 'Escape') return stop()
    if (event.key === 'Backspace' || event.key === 'Delete') {
      current = ''
      onChange('')
      return stop()
    }

    const accelerator = fromKeyboardEvent(event)
    // A modifier on its own is a chord still being pressed, not an answer.
    if (!accelerator) return

    current = accelerator
    onChange(accelerator)
    stop()
  }

  const start = () => {
    listening = true
    /*
     * The app's own global shortcuts are swallowed before any window sees them, so they
     * stand down while this listens — otherwise the five chords most worth rebinding are
     * the five you cannot press here.
     */
    onRecording(true)
    window.addEventListener('keydown', onKeyDown, true)
    paint()
  }

  const stop = () => {
    listening = false
    window.removeEventListener('keydown', onKeyDown, true)
    onRecording(false)
    paint()
  }

  // Clicking elsewhere abandons a recording rather than leaving the window swallowing keys.
  root.addEventListener('blur', () => listening && stop())

  paint()
  return {
    root,
    set: (value) => {
      if (listening) return
      current = value ?? ''
      paint()
    },
  }
}
