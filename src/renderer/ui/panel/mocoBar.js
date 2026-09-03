import { el, clear, setHidden } from '../dom.js'

/**
 * The MOCO connection in one line: what is queued, and the button that sends it.
 *
 * Pushing is deliberately the only way entries leave this machine — they become billable
 * records, so they are shown before they are submitted.
 */
export const createMocoBar = ({ onConnect, onDisconnect, onPush, onRefresh, onDiscard }) => {
  const summary = el('span', { class: 'moco-summary' })

  const pushButton = el('button', {
    class: 'button button--primary button--small',
    type: 'button',
    text: 'Push',
    onclick: onPush,
  })

  const connectButton = el('button', {
    class: 'button button--quiet',
    type: 'button',
    text: 'Connect',
    onclick: () => toggleForm(true),
  })

  const listButton = el('button', {
    class: 'link',
    type: 'button',
    text: 'Review',
    onclick: () => toggleList(),
  })

  const row = el('div', { class: 'moco-row' }, [summary, listButton, pushButton, connectButton])

  /*
   * What MOCO actually said when a push would not go through. It used to be the summary
   * line's tooltip, which is to say invisible — and the one thing a failed push needs to
   * tell you is why, because "3 failed" is not something anybody can act on.
   */
  const pushError = el('p', { class: 'moco-error' })

  // --- connect form -------------------------------------------------------------
  const subdomain = el('input', {
    class: 'moco-input',
    type: 'text',
    placeholder: 'subdomain',
    'aria-label': 'MOCO subdomain',
    autocomplete: 'off',
    spellcheck: 'false',
  })

  const apiKey = el('input', {
    class: 'moco-input',
    // A password field so the key is not left on screen over someone's shoulder.
    type: 'password',
    placeholder: 'API key',
    'aria-label': 'MOCO API key',
    autocomplete: 'off',
  })

  const formError = el('p', { class: 'moco-error' })

  const submit = () => {
    formError.textContent = ''
    if (!subdomain.value.trim() || !apiKey.value.trim()) {
      formError.textContent = 'Both the subdomain and an API key are needed.'
      return
    }
    onConnect({ subdomain: subdomain.value, apiKey: apiKey.value })
    // Cleared immediately; the key lives in the Keychain, not in a text field.
    apiKey.value = ''
  }

  for (const field of [subdomain, apiKey]) {
    field.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') (event.preventDefault(), submit())
      if (event.key === 'Escape') (event.stopPropagation(), toggleForm(false))
    })
  }

  const form = el('div', { class: 'moco-form', hidden: true }, [
    el('div', { class: 'moco-fields' }, [
      subdomain,
      el('span', { class: 'moco-suffix', text: '.mocoapp.com' }),
    ]),
    apiKey,
    formError,
    el('div', { class: 'row row--end' }, [
      el('button', { class: 'button button--quiet', type: 'button', text: 'Cancel', onclick: () => toggleForm(false) }),
      el('button', { class: 'button button--primary button--small', type: 'button', text: 'Connect', onclick: submit }),
    ]),
    el('p', {
      class: 'hint',
      text: 'MOCO → Profile → Integrations. The key is stored in your Keychain.',
    }),
  ])

  // --- queued entries -----------------------------------------------------------
  const list = el('ul', { class: 'moco-queue', hidden: true, 'aria-label': 'Queued entries' })

  const root = el('section', { class: 'moco' }, [row, pushError, form, list])

  let showList = false

  function toggleForm(open) {
    setHidden(form, !open)
    if (open) subdomain.focus()
    else formError.textContent = ''
  }

  function toggleList() {
    showList = !showList
    setHidden(list, !showList)
  }

  const renderQueue = (entries) => {
    clear(list)
    for (const entry of entries) {
      list.append(
        el('li', { class: 'moco-entry', dataset: { failed: String(Boolean(entry.error)) } }, [
          el('span', { class: 'moco-entry-label', text: entry.label ?? entry.description }),
          el('span', { class: 'moco-entry-meta', text: `${entry.date} · ${entry.hours}h` }),
          el('button', {
            class: 'icon-button',
            type: 'button',
            title: 'Discard without sending',
            'aria-label': 'Discard entry',
            text: '×',
            onclick: () => onDiscard(entry.id),
          }),
        ]),
      )
    }
  }

  const update = ({ moco }) => {
    if (!moco) return setHidden(root, true)

    const { available, connected, pending, failed, taskCount, subdomain: host, lastError } = moco

    /*
     * Connected with nothing waiting is not news, and a permanent "123 tasks" badge is
     * just clutter. The bar shows up when something needs doing; the footer dot carries
     * the standing state.
     */
    const needsAttention = !available || !connected || pending > 0 || Boolean(lastError)
    setHidden(root, !needsAttention)
    if (!needsAttention) return

    if (!available) {
      summary.textContent = 'Keychain unavailable — MOCO cannot be connected safely.'
      for (const node of [pushButton, connectButton, listButton]) setHidden(node, true)
      return
    }

    setHidden(connectButton, connected)
    setHidden(pushButton, !connected || pending === 0)
    setHidden(listButton, pending === 0)

    if (!connected) {
      summary.textContent = pending > 0 ? `${pending} entries waiting · not connected` : 'MOCO not connected'
    } else if (pending === 0) {
      summary.textContent = `MOCO ${host} · ${taskCount} tasks`
    } else {
      const noun = pending === 1 ? 'entry' : 'entries'
      summary.textContent = failed > 0 ? `${pending} ${noun} · ${failed} failed` : `${pending} ${noun} queued`
    }

    root.dataset.state = !connected ? 'off' : failed > 0 ? 'failed' : pending > 0 ? 'pending' : 'ok'
    // `.moco-error:empty` hides itself, so clearing the text is all that closing it takes.
    pushError.textContent = lastError ?? ''
    summary.title = lastError ?? ''
    renderQueue(moco.entries ?? [])
    if (connected) toggleForm(false)
  }

  return { root, update, refresh: onRefresh, disconnect: onDisconnect }
}
