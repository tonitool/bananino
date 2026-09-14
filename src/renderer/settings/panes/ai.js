import { el } from '../../ui/dom.js'
import { group, row, button, segmented } from '../controls.js'

/**
 * Where the chat's words may go, and the key behind the cloud side of that choice.
 *
 * BYOK on purpose: the key is the user's own OpenRouter account, never baked into the
 * app — a key inside a distributable binary is a leaked budget. It is write-only here:
 * pasted in, stored in the Keychain, and the window only ever learns the boolean "saved".
 */
export const createAiPane = ({ setEngine, saveKey, forgetKey, checkTools, onToolCheck }) => {
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

  /*
   * The tools, run for real.
   *
   * A small local model relaying a tool result can produce "I cannot run the search, and
   * it found no matches" — two answers in one sentence, neither necessarily the tool's.
   * This runs the same code the chat runs and prints what came back, so "is it the app or
   * the model" stops being a guess.
   */
  const checkResults = el('div', { class: 'checks' })
  const checkButton = button({
    text: 'Check what it can reach',
    onclick: () => {
      checkResults.replaceChildren(el('p', { class: 'check-line', text: 'Checking…' }))
      checkTools()
    },
  })

  onToolCheck((checks) => {
    checkResults.replaceChildren(
      ...(checks ?? []).map((check) =>
        el('p', { class: 'check-line', dataset: { state: check.state } }, [
          el('span', { class: 'check-label', text: check.label }),
          el('span', { class: 'check-detail', text: check.detail }),
        ]),
      ),
    )
  })

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
    group(
      row({
        label: 'Check what it can reach',
        description:
          'Runs the file search, Messages, the music and the rewrite permission for real — ' +
          'no model involved. If a tool works here but the chat says it cannot, the model ' +
          'is the one to change.',
        control: checkButton,
      }),
    ),
    checkResults,
  ])

  const update = (snapshot) => {
    const ai = snapshot.ai ?? {}
    if (ai.engine) engine.set(ai.engine)
    keyInputRow.hidden = Boolean(ai.hasCloudKey)
    keySavedRow.hidden = !ai.hasCloudKey
  }

  return { root, update }
}
