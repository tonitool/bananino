import { CHAT } from '../constants.js'
import { LlmUnavailable, checkOllama, streamChat } from '../meeting/llm.js'
import { buildMessages } from './prompt.js'

/**
 * The conversation, and the only place that decides what the panel's chat is allowed to
 * know or say.
 *
 * Ollama only. There is an OpenRouter path in this app already — the meeting summariser
 * can fall back to it with a saved key — and the chat deliberately does not use it. A
 * summary is one request the user asked for and was told about; a conversation is an open
 * pipe to whatever you happen to type at your desk, including the day's notes and the
 * clipboard that travel in the prompt. "Nothing leaves this Mac" is a claim worth being
 * able to make without an asterisk, and it is only true if there is no cloud path at all.
 *
 * The Ollama client itself lives in meeting/llm.js, which is where it was first needed.
 */

/** The thread is capped so a long day cannot grow the prompt or the panel without end. */
const MAX_MESSAGES = 80

export const createChat = ({ getSnapshot, onState }) => {
  /** `{ role: 'user' | 'assistant', text, failed? }`, oldest first. */
  let messages = []
  let engine = { ok: false, checking: true }
  let streaming = false
  let inFlight = null

  const state = () => ({
    engine,
    streaming,
    messages: messages.map(({ role, text, failed }) => ({ role, text, failed: failed ?? false })),
  })

  const publish = () => onState(state())

  /**
   * Whether there is a model to talk to. Checked at boot and again whenever a send fails,
   * rather than on a timer: `ollama serve` starting or stopping is a rare event, and a
   * poll every few seconds would keep a laptop's radio awake for nothing.
   */
  const checkEngine = async () => {
    engine = { ...engine, checking: true }
    publish()

    const result = await checkOllama()
    engine = result.ok
      ? { ok: true, checking: false, model: result.model }
      : { ok: false, checking: false, reason: result.reason, hint: result.hint }
    publish()
    return engine
  }

  const remember = (message) => {
    messages.push(message)
    if (messages.length > MAX_MESSAGES) messages = messages.slice(-MAX_MESSAGES)
  }

  const send = async (text) => {
    const question = text.trim()
    if (!question || streaming) return

    if (!engine.ok && !(await checkEngine()).ok) {
      remember({ role: 'user', text: question })
      remember({
        role: 'assistant',
        text: `${engine.reason ?? 'No local model is available.'}${
          engine.hint ? ` Try: ${engine.hint}` : ''
        }`,
        failed: true,
      })
      return publish()
    }

    remember({ role: 'user', text: question })
    // The empty reply is the "thinking" state: the view shows a placeholder for a bubble
    // with no text yet, so there is no second flag to keep in step with this one.
    remember({ role: 'assistant', text: '' })
    streaming = true
    publish()

    const reply = messages.at(-1)
    inFlight = new AbortController()
    const timeout = setTimeout(() => inFlight?.abort(), CHAT.timeoutMs)

    /*
     * Tokens arrive far faster than a panel needs to repaint, and every repaint is an IPC
     * message plus a layout pass in a window that is also rendering a 3D character. So the
     * text is published on a fixed beat instead — fast enough to read as typing, slow
     * enough that the character does not stutter while the model talks.
     */
    let latest = ''
    let dirty = false
    const beat = setInterval(() => {
      if (!dirty) return
      dirty = false
      reply.text = latest
      publish()
    }, CHAT.repaintMs)

    try {
      const answer = await streamChat({
        model: engine.model,
        messages: buildMessages({ history: messages.slice(0, -1), snapshot: getSnapshot() }),
        signal: inFlight.signal,
        onText: (soFar) => {
          latest = soFar
          dirty = true
        },
      })
      reply.text = answer.trim() || 'I did not have anything to say to that.'
    } catch (error) {
      const aborted = error.name === 'AbortError'
      reply.text = aborted
        ? 'Stopped.'
        : error instanceof LlmUnavailable
          ? error.message
          : `The local model could not answer: ${error.message}`
      reply.failed = !aborted
      // A failure is usually Ollama having gone away, so the engine line stops claiming a
      // model that is no longer there.
      if (!aborted) void checkEngine()
    } finally {
      clearInterval(beat)
      clearTimeout(timeout)
      inFlight = null
      streaming = false
      publish()
    }
  }

  return {
    state,
    /** Called when the view opens, so a model started after launch is picked up. */
    refresh: () => (engine.ok || engine.checking ? publish() : void checkEngine()),
    send,
    stop: () => inFlight?.abort(),
    clear: () => {
      inFlight?.abort()
      messages = []
      publish()
    },
    start: () => void checkEngine(),
  }
}
