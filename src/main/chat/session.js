import { CHAT } from '../constants.js'
import { LlmUnavailable, checkOllama, streamChat } from '../meeting/llm.js'
import { buildMessages } from './prompt.js'
import { createTools, toolSchemas } from './tools.js'

/**
 * The conversation, and the only place that decides what the panel's chat is allowed to
 * know or do.
 *
 * Ollama only. There is an OpenRouter path in this app already — the meeting summariser
 * can fall back to it with a saved key — and the chat deliberately does not use it. A
 * summary is one request the user asked for and was told about; a conversation is an open
 * pipe to whatever you happen to type at your desk, including the day's notes and the
 * clipboard that travel in the prompt.
 *
 * The Ollama client itself lives in meeting/llm.js, which is where it was first needed.
 *
 * On acting: tools.js holds the rule and the reasons. Here it is only enforced — a tool
 * with an `undo` is run and gets a card with an Undo pill, one without is staged as a
 * proposal and does nothing until the card is pressed.
 */

/** The thread is capped so a long day cannot grow the prompt or the panel without end. */
const MAX_MESSAGES = 80

/**
 * How many times a turn may come back with another tool call before it has to speak.
 *
 * Not a safety limit — nothing irreversible can happen without a press either way — but a
 * patience one: a small model that has decided to look something up will happily look it
 * up again, and each round is another full pass over the conversation.
 */
const MAX_TOOL_ROUNDS = 4

export const createChat = ({
  getSnapshot,
  onState,
  actions,
  readNotes,
  readClips,
  searchTasks,
  getModel,
  setModel,
}) => {
  const tools = createTools({ actions, getSnapshot, readNotes, readClips, searchTasks })
  const schemas = toolSchemas(tools)

  /**
   * The thread, in display order. Three kinds of entry:
   *   - `{ role: 'user' | 'assistant', text }` — what was said.
   *   - `{ role: 'action', ... }` — something done, proposed, or refused. These are also
   *     what the model is shown as its own tool calls and their results, so it knows what
   *     happened and does not claim an act it only offered.
   */
  let messages = []
  let engine = { ok: false, checking: true }
  let streaming = false
  let inFlight = null
  let nextId = 1

  const state = () => ({
    engine,
    streaming,
    messages: messages.map((message) =>
      message.role === 'action'
        ? {
            role: 'action',
            id: message.id,
            tool: message.tool,
            title: message.title,
            detail: message.detail,
            status: message.status,
          }
        : { role: message.role, text: message.text, failed: message.failed ?? false },
    ),
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

    /*
     * `allowCloud` is granted only by the user having named a cloud model themselves. The
     * automatic pick never reaches for one: see isCloudModel in meeting/llm.js — an
     * Ollama cloud model is used through the same localhost port as a local one, so
     * without this a paid plan would quietly start sending the day's notes off the Mac.
     */
    const prefer = getModel()
    const result = await checkOllama({ prefer, allowCloud: Boolean(prefer) })

    engine = result.ok
      ? {
          ok: true,
          checking: false,
          model: result.model,
          isLocal: result.isLocal !== false,
          available: result.available ?? [],
        }
      : {
          ok: false,
          checking: false,
          reason: result.reason,
          hint: result.hint,
          available: result.available ?? [],
        }
    publish()
    return engine
  }

  const remember = (message) => {
    messages.push(message)
    if (messages.length > MAX_MESSAGES) messages = messages.slice(-MAX_MESSAGES)
    return message
  }

  /**
   * One tool call: looked up, then run, staged or read, and recorded as a card.
   *
   * The `told` string is what the model is handed back. It is written in the past tense
   * for something done and plainly conditional for something proposed, because that
   * sentence is the only thing stopping the next paragraph from announcing an act that
   * has not happened.
   */
  const callTool = async ({ name, args }) => {
    const tool = tools[name]
    if (!tool) {
      return remember({
        role: 'action',
        id: nextId++,
        tool: name,
        title: `Unknown tool · ${name}`,
        detail: 'nothing was done',
        status: 'failed',
        call: { name, args },
        told: `There is no tool called "${name}".`,
      })
    }

    // A read is not an act: no card, nothing to undo, and the answer goes straight back.
    if (tool.read) {
      const told = await tool.read(args)
      return remember({
        role: 'action',
        id: nextId++,
        tool: name,
        status: 'read',
        call: { name, args },
        told: String(told),
      })
    }

    const outcome = await (tool.undo ? tool.run(args) : tool.propose(args))

    if (outcome.failed) {
      return remember({
        role: 'action',
        id: nextId++,
        tool: name,
        title: outcome.failed,
        detail: 'nothing was done',
        status: 'failed',
        call: { name, args },
        told: `That did not happen: ${outcome.failed}`,
      })
    }

    const done = Boolean(tool.undo)
    return remember({
      role: 'action',
      id: nextId++,
      tool: name,
      title: outcome.title,
      detail: outcome.detail,
      status: done ? (outcome.undoable === false ? 'done' : 'undoable') : 'proposed',
      call: { name, args },
      // Carried so Undo can find what it has to take back — a note's index, say.
      result: outcome,
      told: done
        ? (outcome.told ?? 'Done.')
        : `Nothing has happened yet. The user has been shown a card reading "${outcome.title}" and has to press it. Say that you have offered it, not that you have done it.`,
    })
  }

  /** Acting on a card: the press that runs a proposal, or the Undo of something done. */
  const act = async (id, choice) => {
    const action = messages.find(
      (message) => message.role === 'action' && message.id === Number(id),
    )
    if (!action) return

    try {
      if (choice === 'confirm' && action.status === 'proposed') {
        const tool = tools[action.tool]
        const outcome = await tool.run(action.call.args)
        action.status = 'confirmed'
        action.detail = outcome?.told ?? 'done'
      }

      if (choice === 'undo' && action.status === 'undoable') {
        const tool = tools[action.tool]
        action.detail = await tool.undo(action.result ?? {})
        action.status = 'undone'
      }
    } catch (error) {
      console.error(`[chat] could not ${choice} ${action.tool}:`, error)
      action.status = 'failed'
      action.detail = error.message
    }
    publish()
  }

  /**
   * One turn: ask, act on whatever comes back, and let the model see the result before it
   * speaks. Every round streams into a bubble of its own, so a turn that looks something
   * up reads as a sentence, then a card, then the answer.
   */
  const runTurn = async () => {
    for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
      const reply = remember({ role: 'assistant', text: '' })
      publish()

      let latest = ''
      let dirty = false
      /*
       * Tokens arrive far faster than a panel needs to repaint, and every repaint is an
       * IPC message plus a layout pass in a window that is also rendering a 3D character.
       * So the text is published on a fixed beat instead — fast enough to read as typing,
       * slow enough that the character does not stutter while the model talks.
       */
      const beat = setInterval(() => {
        if (!dirty) return
        dirty = false
        reply.text = latest
        publish()
      }, CHAT.repaintMs)

      let calls = []
      try {
        const answer = await streamChat({
          model: engine.model,
          messages: buildMessages({ history: messages.slice(0, -1), snapshot: getSnapshot() }),
          tools: schemas,
          signal: inFlight.signal,
          onText: (soFar) => {
            latest = soFar
            dirty = true
          },
        })
        reply.text = answer.text.trim()
        calls = answer.calls
      } finally {
        clearInterval(beat)
      }

      // A round that only called a tool said nothing worth a bubble.
      if (!reply.text) messages = messages.filter((message) => message !== reply)
      publish()

      if (calls.length === 0) {
        if (!reply.text) remember({ role: 'assistant', text: 'I did not have anything to say to that.' })
        return
      }

      for (const call of calls) {
        await callTool({ name: call.name, args: parseArguments(call.arguments) })
        publish()
      }
    }

    remember({
      role: 'assistant',
      text: 'I kept going in circles looking things up, so I stopped. Ask me again more plainly?',
      failed: true,
    })
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
    streaming = true
    publish()

    inFlight = new AbortController()
    const timeout = setTimeout(() => inFlight?.abort(), CHAT.timeoutMs)

    try {
      await runTurn()
    } catch (error) {
      const aborted = error.name === 'AbortError'
      remember({
        role: 'assistant',
        text: aborted
          ? 'Stopped.'
          : error instanceof LlmUnavailable
            ? error.message
            : `The model could not answer: ${error.message}`,
        failed: !aborted,
      })
      // A failure is usually Ollama having gone away, so the engine line stops claiming a
      // model that is no longer there.
      if (!aborted) void checkEngine()
    } finally {
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
    act,
    stop: () => inFlight?.abort(),
    /**
     * Choosing the model, from the chat's own engine line — which is also where the line
     * about where the words go is written, so the choice and its consequence are one
     * sentence apart rather than in two different views.
     */
    choose: (name) => {
      setModel(name)
      return checkEngine()
    },
    clear: () => {
      inFlight?.abort()
      messages = []
      publish()
    },
    start: () => void checkEngine(),
  }
}

/** Arguments arrive as an object from Ollama and as a JSON string from some models. */
const parseArguments = (args) => {
  if (args && typeof args === 'object') return args
  try {
    return JSON.parse(String(args ?? '{}'))
  } catch {
    return {}
  }
}
