import { clear, el, setHidden } from '../dom.js'

/**
 * The conversation. Everything here runs against a model on this Mac, which is the only
 * reason a pet gets to read your notes and your clipboard at all.
 *
 * Two decisions worth keeping:
 *
 * The thread has its own scroll container from the first commit, not once it becomes a
 * problem. The panel's height is measured and the window resized to match, so a growing
 * transcript would grow the window until it ran off the screen — and it would take the
 * character with it.
 *
 * The thread is reconciled rather than rebuilt. State arrives from the main process
 * roughly sixteen times a second while an answer streams, and replacing the list on every
 * one of those would restart every animation, drop any text the user had selected, and
 * fight their scroll position all the way through the answer.
 */

/**
 * An act, as a card in the thread.
 *
 * Two shapes, from one rule the main process enforces (see chat/tools.js): something
 * reversible has already happened and carries an Undo; something irreversible has not
 * happened and carries the press that would do it. The card says which in its own words —
 * "Undo" against a past tense, a verb against a future one — because a pill that means
 * two different things depending on a colour is how you undo the wrong thing.
 */
const cardOf = (action, { onAct }) => {
  const title = el('p', { class: 'card-title' })
  const detail = el('p', { class: 'card-detail' })
  const button = el('button', { class: 'card-do', type: 'button' })

  const root = el('div', { class: 'card' }, [
    el('div', { class: 'card-body' }, [title, detail]),
    button,
  ])

  const render = (next) => {
    root.dataset.status = next.status
    title.textContent = next.title ?? ''
    detail.textContent = next.detail ?? ''
    setHidden(detail, !next.detail)

    const offer =
      next.status === 'undoable' ? 'Undo' : next.status === 'proposed' ? 'Do it' : null
    button.textContent = offer ?? ''
    setHidden(button, !offer)
    button.onclick = offer
      ? () => onAct(next.id, next.status === 'undoable' ? 'undo' : 'confirm')
      : null
  }

  render(action)
  return { root, render }
}

const bubbleOf = (message) => {
  const bubble = el('div', { class: 'bubble' }, [el('p', { class: 'bubble-text' })])
  const text = bubble.firstChild

  const render = ({ role, text: body, failed }) => {
    bubble.dataset.role = role
    bubble.dataset.failed = String(Boolean(failed))
    /*
     * An assistant bubble with nothing in it is the waiting state — the model has been
     * asked and has not produced a first token yet. A separate spinner would be a second
     * thing to keep in step with this one.
     */
    const waiting = role === 'assistant' && !body
    bubble.dataset.waiting = String(waiting)
    text.textContent = waiting ? '· · ·' : body
  }

  render(message)
  return { root: bubble, render }
}

export const createChatTab = ({ onSend, onStop, onClear, onAct, onModel }) => {
  const thread = el('div', { class: 'thread', role: 'log', 'aria-live': 'polite' })
  const empty = el('p', {
    class: 'thread-empty',
    text:
      'Ask about your day, or ask for something done — start a timer, write a note, ' +
      'log time you forgot.',
  })

  const input = el('textarea', {
    class: 'note-input chat-input',
    placeholder: 'Message Bananino',
    'aria-label': 'Message Bananino',
    rows: '2',
  })

  const sendButton = el('button', {
    class: 'button button--primary',
    type: 'button',
    text: 'Send',
    onclick: () => submit(),
  })

  const stopButton = el('button', {
    class: 'button',
    type: 'button',
    text: 'Stop',
    hidden: true,
    onclick: () => onStop(),
  })

  const clearButton = el('button', {
    class: 'link chat-clear',
    type: 'button',
    text: 'Clear',
    title: 'Forget this conversation',
    onclick: () => onClear(),
  })

  /**
   * Who is answering, always on screen — and the one control that changes it.
   *
   * The picker lives here rather than in Settings because the sentence beside it is the
   * consequence: an Ollama cloud model is reached through the same localhost port as a
   * local one, so "on your Mac · nothing leaves" and "Ollama cloud · leaves this Mac" are
   * the only thing distinguishing them, and choosing one three views away from that line
   * would be choosing it blind.
   */
  const engineLed = el('span', { class: 'engine-led', 'aria-hidden': 'true' })
  const engineText = el('span', { class: 'engine-text' })
  const engineHint = el('code', { class: 'engine-hint', hidden: true })
  const engineModel = el('select', {
    class: 'engine-model',
    'aria-label': 'Which model answers',
    hidden: true,
    onchange: (event) => onModel(event.target.value),
  })
  // The model first, then what choosing it means: the order the sentence has to be read in.
  const engine = el('p', { class: 'engine' }, [engineLed, engineModel, engineText, engineHint])

  const root = el('section', { class: 'tab-panel', id: 'tab-chat', role: 'tabpanel' }, [
    thread,
    empty,
    input,
    // Send is pinned to the right whether or not Clear is there to balance it: a lone
    // primary button drifting to the left of the row is how the composer first looked.
    el('div', { class: 'row row--end' }, [clearButton, stopButton, sendButton]),
    engine,
  ])

  const submit = () => {
    const text = input.value.trim()
    if (!text || streaming) return input.focus()
    input.value = ''
    onSend(text)
  }

  input.addEventListener('keydown', (event) => {
    /*
     * Enter sends and shift-Enter breaks the line, which is the convention every chat on
     * this machine already uses. The note tab is the other way round on purpose: there, a
     * note is usually several lines and saving is the rarer act.
     */
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      submit()
    }
  })

  let rows = []
  let streaming = false

  /**
   * The options, rebuilt only when the model list actually changes — a `<select>` that is
   * rewritten while its menu is open closes it under the user's cursor, and this repaints
   * on every beat of a streaming answer.
   */
  let listed = ''
  const renderModels = ({ available = [], model }) => {
    setHidden(engineModel, available.length === 0)
    const key = `${model}|${available.map((entry) => entry.name).join(',')}`
    if (key === listed) return
    listed = key

    clear(engineModel)
    // The automatic pick is an option of its own, so there is a way back to "whatever is
    // local" without having to remember which model that was.
    engineModel.append(el('option', { value: '', text: 'automatic (local)' }))
    for (const entry of available) {
      /*
       * No "— cloud" suffix: a cloud model is *recognised* by its name ending in -cloud
       * (see isCloudModel), so the tag would always be repeating the last word of the
       * option it is attached to, and it pushed the real name out of a 152px select.
       */
      engineModel.append(
        el('option', { value: entry.name, text: entry.name, selected: entry.name === model }),
      )
    }
    engineModel.value = available.some((entry) => entry.name === model) ? model : ''
  }

  const renderEngine = (state) => {
    const { ok, checking, model, isLocal, reason, hint } = state ?? {}
    engineLed.dataset.state = checking ? 'checking' : ok ? (isLocal ? 'ok' : 'cloud') : 'off'
    /*
     * Kept to a handful of words because the rail is 316px and this shares the line with
     * the model's own name: an accurate sentence that wraps under the select and gets cut
     * off is not a claim anybody reads.
     */
    engineText.textContent = checking
      ? 'looking for a model…'
      : ok
        ? isLocal
          ? 'nothing leaves this Mac'
          : 'this leaves your Mac'
        : (reason ?? 'no local model')
    engineHint.textContent = hint ?? ''
    setHidden(engineHint, ok || checking || !hint)
    renderModels(state ?? {})
  }

  /**
   * A read is not shown. The main process keeps it in the thread because the model has to
   * see what it looked up, but a card reading "looked at your notes" is noise in a
   * conversation whose next sentence is about those notes.
   */
  const isVisible = (message) => message.role !== 'action' || message.status !== 'read'

  /**
   * The thread is only appended to and its last entry rewritten, which is exactly what a
   * conversation does. Anything else — a cleared thread, a read appearing in the middle —
   * starts the list over, which is rare enough to cost nothing.
   */
  const renderThread = (all) => {
    const messages = all.filter(isVisible)
    const stale = messages.length < rows.length || rows.some((row, i) => row.role !== messages[i]?.role)
    if (stale) {
      clear(thread)
      rows = []
    }

    messages.forEach((message, index) => {
      if (rows[index]) return rows[index].render(message)
      const row = message.role === 'action' ? cardOf(message, { onAct }) : bubbleOf(message)
      row.role = message.role
      rows[index] = row
      thread.append(row.root)
    })

    setHidden(thread, messages.length === 0)
    setHidden(empty, messages.length > 0)
  }

  /**
   * Whether the reader is following the answer or has scrolled up to look at something
   * earlier. Measured *before* the render, not after: after appending a screen's worth of
   * new messages everyone looks scrolled-up, and a restored conversation opened parked at
   * its first line.
   */
  const isFollowing = () => thread.scrollHeight - thread.scrollTop - thread.clientHeight < 48

  const setState = (state) => {
    streaming = Boolean(state.streaming)
    const following = isFollowing()
    renderThread(state.messages ?? [])
    renderEngine(state.engine)

    setHidden(stopButton, !streaming)
    setHidden(sendButton, streaming)
    setHidden(clearButton, (state.messages ?? []).length === 0)
    // Not disabled while it answers: drafting the next question during a slow local
    // answer is the normal thing to want, and `submit` already refuses to send two.
    if (following) thread.scrollTop = thread.scrollHeight
  }

  return {
    root,
    setState,
    // Painted from its own channel, not the snapshot: a conversation is not a view of the
    // day, and it changes on a completely different beat.
    update: () => {},
    focus: () => input.focus(),
  }
}
