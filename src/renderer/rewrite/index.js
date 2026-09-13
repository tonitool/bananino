import './rewrite.css'
import { clear, el, setHidden } from '../ui/dom.js'

/**
 * The rewrite popup.
 *
 * A small window with one job and one rule: **nothing changes your document until you
 * click a version.** So the versions are the only thing in here that looks like a button
 * worth pressing, and the instruction row above them is the only thing that can be typed
 * into. Everything else is a label.
 *
 * It reports its own height after every render — the window is sized to the content, and
 * "nothing was selected" is a very different shape from three rewritten paragraphs.
 */

const bridge = window.pet

const title = el('span', { class: 'rw-title', text: 'Rewrite' })
const where = el('span', { class: 'rw-where' })
const source = el('p', { class: 'rw-source' })

const input = el('input', {
  class: 'rw-input',
  type: 'text',
  placeholder: 'Tell me how to rewrite it…',
  'aria-label': 'How to rewrite the selected text',
  spellcheck: 'false',
})

const presets = el('div', { class: 'rw-presets' })
const body = el('div', { class: 'rw-body' })
const footer = el('p', { class: 'rw-footer' })

const root = el('div', { class: 'rw' }, [
  el('header', { class: 'rw-head' }, [title, where]),
  source,
  el('form', {
    class: 'rw-ask',
    onsubmit: (event) => {
      event.preventDefault()
      const instruction = input.value.trim()
      if (instruction) bridge.rewriteAsk(instruction)
    },
  }, [input]),
  presets,
  body,
  footer,
])

document.getElementById('rewrite-window').append(root)

/** The window is sized to what is in it, measured after the browser has laid it out. */
const reportHeight = () => {
  requestAnimationFrame(() => bridge.rewriteHeight(Math.ceil(root.getBoundingClientRect().height)))
}

const spinner = () => el('div', { class: 'rw-thinking' }, [
  el('span', { class: 'rw-dot' }),
  el('span', { class: 'rw-dot' }),
  el('span', { class: 'rw-dot' }),
])

/**
 * One version, as a card you press.
 *
 * The whole text is shown rather than a preview: this is about to become someone's email,
 * and a version you cannot read in full is one you cannot agree to.
 */
const variantCard = (text, index) =>
  el('button', {
    class: 'rw-variant',
    type: 'button',
    title: 'Replace the selected text with this',
    onclick: () => bridge.rewriteUse(index),
  }, [
    el('span', { class: 'rw-variant-index', text: String(index + 1) }),
    el('span', { class: 'rw-variant-text', text }),
  ])

const renderPresets = (list, disabled) => {
  clear(presets)
  for (const preset of list ?? []) {
    presets.append(
      el('button', {
        class: 'rw-preset',
        type: 'button',
        disabled,
        onclick: () => bridge.rewriteAsk(preset.instruction),
      }, [el('span', { text: preset.label })]),
    )
  }
}

const render = (state) => {
  const { stage } = state

  where.textContent = state.app ? `in ${state.app}` : ''
  setHidden(where, !state.app)

  source.textContent = state.preview ?? ''
  setHidden(source, !state.preview)

  const canAsk = stage === 'ready' || stage === 'options' || stage === 'replaced'
  setHidden(input.parentElement, !canAsk)
  setHidden(presets, !canAsk)
  input.disabled = !canAsk
  renderPresets(state.presets, !canAsk)

  clear(body)
  footer.textContent = ''

  if (stage === 'reading' || stage === 'thinking') {
    body.append(spinner())
  }

  if (stage === 'failed') {
    body.append(
      el('p', { class: 'rw-error', text: state.error ?? 'That did not work.' }),
      ...(state.hint ? [el('p', { class: 'rw-hint', text: state.hint })] : []),
    )
  }

  if (stage === 'options' && state.variants?.length) {
    body.append(
      el('p', { class: 'rw-label', text: state.restored ? 'Put back. Pick another?' : 'Pick one to replace it' }),
      ...state.variants.map(variantCard),
    )
  }

  if (stage === 'replaced') {
    body.append(
      el('p', { class: 'rw-done', text: `Replaced${state.app ? ` in ${state.app}` : ''}.` }),
      el('button', {
        class: 'rw-undo',
        type: 'button',
        onclick: () => bridge.rewriteUndo(),
      }, [el('span', { text: 'Put it back' })]),
    )
  }

  if (stage === 'ready') {
    footer.textContent = 'Pick a preset or type an instruction · esc to close'
  }

  reportHeight()
}

bridge.onRewriteState(render)
bridge.rewriteOpened()

window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') bridge.rewriteClose()
})

/** A number key picks a version, which is quicker than reaching for the mouse. */
window.addEventListener('keydown', (event) => {
  if (document.activeElement === input) return
  const index = Number(event.key) - 1
  if (Number.isInteger(index) && index >= 0 && index < 9) {
    const cards = root.querySelectorAll('.rw-variant')
    cards[index]?.click()
  }
})
