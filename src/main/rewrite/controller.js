import { MAX_SELECTION, PRESETS, buildPrompt, parseVariants, preview } from './prompt.js'

/**
 * The rewrite, from the hotkey to the replaced sentence.
 *
 * One rule shapes the whole flow, and it is the same one the chat's cards follow:
 * **nothing is replaced until you click a version.** Reading your selection and asking a
 * model are free — you can close the popup and nothing has happened. The paste is the
 * press, and it is the only step that touches the document you were writing in.
 *
 * After it, the text you had is kept in `previous` for exactly as long as the popup is
 * open, so **Put it back** is a real undo and not a promise. Closing the popup lets it go:
 * holding someone's paragraph in memory after they have moved on is not tidiness, it is a
 * leak waiting to be found in a crash log.
 */

/** Stages the popup renders. Also the order they happen in. */
export const STAGES = Object.freeze(['reading', 'ready', 'thinking', 'options', 'replaced', 'failed'])

export const createRewrite = ({
  selection,
  askModel,
  onState,
  openWindow,
  closeWindow,
  holdWindow = () => {},
  isAccessibilityTrusted = () => true,
}) => {
  let state = { stage: 'ready', presets: PRESETS }
  let session = null
  let inFlight = null

  const publish = (patch) => {
    state = { ...state, ...patch, presets: PRESETS }
    onState(state)
  }

  const fail = (message, hint) => {
    publish({ stage: 'failed', error: message, hint: hint ?? null, variants: [] })
  }

  /**
   * The hotkey. Everything before the popup opens happens here, because once it opens the
   * app you were in is no longer frontmost and the selection can no longer be copied.
   */
  const start = async () => {
    if (session) return close()

    /*
     * Asked before anything else, and with the system prompt allowed: without this
     * permission the whole feature is a no-op, and macOS only offers the dialog when an
     * app asks for it. Better a system dialog than a popup explaining a system dialog.
     */
    if (!isAccessibilityTrusted(true)) {
      session = { target: null }
      openWindow()
      return fail('Bananino cannot read your selection yet.', ACCESSIBILITY_PANE)
    }

    const target = await selection.frontmost().catch(() => null)
    const captured = await selection.capture()

    session = { target, yours: captured.yours, previous: null }
    openWindow()

    if (captured.failed) return fail(captured.failed)
    if (captured.empty) {
      return fail(
        'Nothing was selected.',
        'Select the text you want rewritten, then press the shortcut again.',
      )
    }

    const text = captured.text
    if (text.length > MAX_SELECTION) {
      return fail(
        `That selection is ${text.length.toLocaleString()} characters — more than I can rewrite in one go.`,
        `Select up to about ${MAX_SELECTION.toLocaleString()} characters.`,
      )
    }

    session.text = text
    publish({
      stage: 'ready',
      app: target?.name ?? null,
      preview: preview(text),
      length: text.length,
      instruction: '',
      variants: [],
      error: null,
      hint: null,
    })
  }

  /** Asking for versions. Cancels a question already in flight rather than queueing it. */
  const ask = async (instruction) => {
    if (!session?.text) return
    const wanted = String(instruction ?? '').trim()
    if (!wanted) return

    inFlight?.abort()
    inFlight = new AbortController()
    const mine = inFlight

    publish({ stage: 'thinking', instruction: wanted, variants: [], error: null, hint: null })

    try {
      const reply = await askModel({
        prompt: buildPrompt({ text: session.text, instruction: wanted }),
        signal: mine.signal,
      })
      if (mine !== inFlight) return

      const variants = parseVariants(reply)
      if (variants.length === 0) {
        return fail('The model sent nothing back that could replace your text.', 'Try again, or word the instruction differently.')
      }

      publish({ stage: 'options', instruction: wanted, variants })
    } catch (error) {
      if (mine !== inFlight || error.name === 'AbortError') return
      fail(error.message ?? 'The model could not answer.')
    }
  }

  /** The press: this is the first and only moment anything outside Bananino changes. */
  const use = async (index) => {
    const text = state.variants?.[Number(index)]
    if (!session?.text || typeof text !== 'string') return

    /*
     * The paste makes another app frontmost, which blurs this popup — and a blurred popup
     * is normally a dismissed one. Held open across the act, so what it has to say next
     * (that it worked, and that it can be put back) is still on screen to be read.
     */
    holdWindow()
    publish({ stage: 'thinking' })
    const outcome = await selection.replace({ text, target: session.target, yours: session.yours })
    if (outcome.failed) return fail(outcome.failed)

    session.previous = session.text
    session.text = text
    publish({ stage: 'replaced', used: text, app: state.app, error: null, hint: null })
  }

  /** Put the original back, while the popup is still open and still holds it. */
  const undo = async () => {
    if (!session?.previous) return

    holdWindow()
    publish({ stage: 'thinking' })
    const outcome = await selection.replace({
      text: session.previous,
      target: session.target,
      yours: session.yours,
    })
    if (outcome.failed) return fail(outcome.failed)

    session.text = session.previous
    session.previous = null
    publish({ stage: 'options', restored: true })
  }

  const close = () => {
    inFlight?.abort()
    inFlight = null
    /*
     * Whatever you had copied is yours, and a cancelled rewrite must not leave your own
     * selection sitting on the clipboard in its place — ⌘C was pressed by the buddy, not
     * by you.
     */
    if (session?.yours !== undefined) void selection.restore?.(session.yours)
    // The selection goes with the popup: see the note at the top.
    session = null
    state = { stage: 'ready', presets: PRESETS }
    closeWindow()
  }

  return { start, ask, use, undo, close, state: () => state }
}

const ACCESSIBILITY_PANE =
  'Allow it in System Settings → Privacy & Security → Accessibility, then press the shortcut again.'
