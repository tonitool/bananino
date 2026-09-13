import { el } from '../../ui/dom.js'
import { group, recorder, row } from '../controls.js'
import { SHORTCUT_MENU } from '../../../main/constants.js'
import { clashingShortcuts, describeAccelerator } from '../../../main/accelerators.js'

/**
 * The global shortcuts, rebindable.
 *
 * A global shortcut is a claim on the whole system, so two things have to be visible here
 * and nowhere else in the app: which chord did not take because another app already owns
 * it, and which two of these have been given the same keys. Both leave a key that appears
 * to be bound and does nothing — the single most confusing thing a shortcut can do — so
 * each says so in the row it belongs to.
 */
export const createKeysPane = ({ setShortcut, setRecording }) => {
  const rows = SHORTCUT_MENU.map(([id, label, description]) => {
    const control = recorder({
      describe: describeAccelerator,
      onChange: (accelerator) => setShortcut({ id, accelerator }),
      onRecording: setRecording,
    })
    const warning = el('span', { class: 'row-warn', hidden: true })

    return {
      id,
      control,
      warning,
      root: row({
        label,
        description,
        control: el('div', { class: 'rec-cell' }, [control.root, warning]),
      }),
    }
  })

  const root = el('div', { class: 'pane-body' }, [
    group(...rows.map((entry) => entry.root)),
    el('p', {
      class: 'footnote',
      text:
        'Hold ⌘, ⌃ or ⌥ with a key — a shortcut without one would swallow that key in every ' +
        'app on this Mac. Press ⌫ while recording to switch a shortcut off.',
    }),
  ])

  const update = (snapshot) => {
    const values = snapshot.shortcuts?.values ?? {}
    const failed = new Set(snapshot.shortcuts?.failed ?? [])
    const clashing = new Set(clashingShortcuts(values))

    for (const entry of rows) {
      entry.control.set(values[entry.id] ?? '')

      const message = clashing.has(entry.id)
        ? 'Two shortcuts here use this — only one of them will work.'
        : failed.has(entry.id)
          ? 'Another app already owns this combination.'
          : ''

      entry.warning.textContent = message
      entry.warning.toggleAttribute('hidden', !message)
    }
  }

  return { root, update }
}
