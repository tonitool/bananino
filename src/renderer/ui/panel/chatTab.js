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

export const createChatTab = ({ onSend, onStop, onClear }) => {
  const thread = el('div', { class: 'thread', role: 'log', 'aria-live': 'polite' })
  const empty = el('p', {
    class: 'thread-empty',
    text: 'Ask about your day — what you tracked, what you noted, what is coming up.',
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
   * Who is answering, always on screen. This is the same claim the meeting tab makes
   * about a transcript, for the same reason: where the words go is not something a user
   * should have to infer from a settings page.
   */
  const engineLed = el('span', { class: 'engine-led', 'aria-hidden': 'true' })
  const engineText = el('span', { class: 'engine-text' })
  const engineHint = el('code', { class: 'engine-hint', hidden: true })
  const engine = el('p', { class: 'engine' }, [engineLed, engineText, engineHint])

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

  let bubbles = []
  let streaming = false

  const renderEngine = (state) => {
    const { ok, checking, model, reason, hint } = state ?? {}
    engineLed.dataset.state = checking ? 'checking' : ok ? 'ok' : 'off'
    engineText.textContent = checking
      ? 'looking for a local model…'
      : ok
        ? `on your Mac · ${model} · nothing leaves`
        : (reason ?? 'no local model')
    engineHint.textContent = hint ?? ''
    setHidden(engineHint, ok || checking || !hint)
  }

  /**
   * The thread is only appended to and its last bubble only rewritten, which is exactly
   * what a conversation does. A cleared thread is the one case that starts over.
   */
  const renderThread = (messages) => {
    if (messages.length < bubbles.length) {
      clear(thread)
      bubbles = []
    }

    messages.forEach((message, index) => {
      if (bubbles[index]) return bubbles[index].render(message)
      const bubble = bubbleOf(message)
      bubbles[index] = bubble
      thread.append(bubble.root)
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
