import { el } from '../../ui/dom.js'
import { group, row, button, segmented } from '../controls.js'

/**
 * Where the chat's words may go, and the key behind the cloud side of that choice.
 *
 * BYOK on purpose: the key is the user's own OpenRouter account, never baked into the
 * app — a key inside a distributable binary is a leaked budget. It is write-only here:
 * pasted in, stored in the Keychain, and the window only ever learns the boolean "saved".
 */
export const createAiPane = ({ setEngine, saveKey, forgetKey }) => {
  const engine = segmented({
    label: 'Where answers come from',
    options: [
      ['auto', 'Automatic'],
      ['local', 'This Mac'],
      ['cloud', 'Cloud'],
    ],
    onChange: setEngine,
  })

  const keyInput = el('input', {
    class: 'key-input',
    type: 'password',
    placeholder: 'sk-or-…',
    'aria-label': 'OpenRouter API key',
    spellcheck: 'false',
    autocomplete: 'off',
  })

  const saveButton = button({
    text: 'Save key',
    primary: true,
    onclick: () => {
      const value = keyInput.value.trim()
      if (!value) return
      saveKey(value)
      keyInput.value = ''
    },
  })
  keyInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') saveButton.click()
  })

  const keyInputRow = row({
    label: 'OpenRouter key',
    description: 'From openrouter.ai/keys — it lives in the Keychain, never in a file you can read.',
    control: el('div', { class: 'key-edit' }, [keyInput, saveButton]),
  })

  const keySavedRow = row({
    label: 'OpenRouter key',
    description: 'Saved in the Keychain. It also powers the meeting-summary fallback.',
    control: button({ text: 'Forget it', onclick: forgetKey }),
  })

  keyInputRow.hidden = false
  keySavedRow.hidden = true

  const root = el('div', { class: 'pane-body' }, [
    group(
      row({
        label: 'Answers come from',
        description: 'Automatic uses the cloud when a key is saved, and this Mac otherwise.',
        control: engine.root,
      }),
    ),
    group(keyInputRow, keySavedRow),
    el('p', {
      class: 'footnote',
      text: 'On this Mac, chat text, notes, clipboard finds, calendar entries and file paths stay here. In the cloud, what the chat sends — including what its tools looked up — goes to the provider from the key. The engine line under the chat always says which one is answering.',
    }),
  ])

  const update = (snapshot) => {
    const ai = snapshot.ai ?? {}
    if (ai.engine) engine.set(ai.engine)
    keyInputRow.hidden = Boolean(ai.hasCloudKey)
    keySavedRow.hidden = !ai.hasCloudKey
  }

  return { root, update }
}
