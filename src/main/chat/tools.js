import { parseDuration } from '../storage/duration.js'

/**
 * What the buddy is allowed to do, and the rule that decides how.
 *
 * **Reversible acts happen, with an Undo. Irreversible acts wait for a press.**
 *
 * That line is the whole design. A pet that silently edits your billable hours is a
 * liability, and the usual answer — ask before everything — is the other failure: an agent
 * that needs a confirmation to write down a note is slower than the note. So the two
 * cases are separated by whether the act can actually be taken back:
 *
 *   - `undo` present: it runs immediately and the chat shows a card with an Undo pill.
 *     Starting a timer and saving a note are both like this — one has written nothing yet,
 *     the other can be removed from the day's file by the index it landed at.
 *   - `undo` absent: it is *proposed* and nothing happens until you press the card's
 *     button. Stopping a timer appends to the day's log and queues the stint for MOCO;
 *     adding past time writes a billable record; pushing sends it to a server that will
 *     not take it back. None of those can be undone from here, so none of them are done
 *     on a model's say-so.
 *
 * `read` tools are neither: they only look, so they run without a card at all.
 *
 * Every doing tool goes through the same `actions` the buttons call, so the chat cannot
 * take a path the UI does not have — and the buddy reacts and the panel refreshes exactly
 * as if you had clicked it yourself.
 */

/** How the tools are described to the model. Ollama takes OpenAI-shaped function schemas. */
const schema = (name, description, properties = {}, required = []) => ({
  type: 'function',
  function: {
    name,
    description,
    parameters: { type: 'object', properties, required },
  },
})

const string = (description) => ({ type: 'string', description })

/**
 * `actions` is app.js's action set, and the reads are handed in beside it rather than
 * imported: reaching into storage from here would give the chat a path the buttons do not
 * have, and it would drag electron's `app` into a module that is worth testing under plain
 * node. Built as a function so the session can exist before the actions it drives — app.js
 * wires them in that order.
 */
export const createTools = ({ actions, getSnapshot, readNotes, readClips, searchTasks }) => {
  /**
   * A binding only ever comes from certainty: the task named *is* a catalogue entry, or
   * the query the model passed has exactly one answer. Anything fuzzier books to the
   * wrong billable project some day, so no match beats a guessed one.
   */
  const resolveBinding = (name, query) => {
    const toBinding = (entry) => ({ projectId: entry.projectId, taskId: entry.taskId, label: entry.label })

    if (query) {
      const candidates = searchTasks(query, 10)
      return candidates.length === 1 ? toBinding(candidates[0]) : null
    }

    const equal = (a, b) =>
      a.replace(/\s*[—–-]\s*/g, ' — ').replace(/\s+/g, ' ').trim().toLowerCase() ===
      b.replace(/\s*[—–-]\s*/g, ' — ').replace(/\s+/g, ' ').trim().toLowerCase()
    const direct = searchTasks(name, 10).filter((entry) => equal(entry.label, name))
    return direct.length === 1 ? toBinding(direct[0]) : null
  }

  const tools = {
    start_timer: {
      schema: schema(
        'start_timer',
        'Start tracking time on a task. Refuses if a timer is already running. To bill the stint to MOCO, pass moco_query with words from the project; only a single match binds, anything vaguer stays local.',
        {
          task: string('The task name, e.g. "BIK · Konzeption".'),
          description: string('Optional note about what you are doing, for MOCO.'),
          moco_query: string('Optional: words naming the MOCO project or task, e.g. "creative engine junior".'),
        },
        ['task'],
      ),
      run: async ({ task, description, moco_query }) => {
        const name = String(task ?? '').trim()
        if (!name) return { failed: 'No task name was given.' }

        /*
         * Refused rather than handled, because `timer.start` stops whatever is running —
         * and stopping *logs* it. That would make this act partly irreversible behind an
         * Undo pill that could not put the logged stint back.
         */
        if (getSnapshot().timer) {
          return {
            failed: `A timer is already running on "${getSnapshot().timer.task}". Stopping it writes an entry, so ask the user to stop it first.`,
          }
        }

        const binding = resolveBinding(name, String(moco_query ?? '').trim() || null)
        await actions.startTimer(name, binding, String(description ?? ''))
        return {
          title: `Timer started · ${name}`,
          detail: description ? String(description) : binding ? `books to ${binding.label}` : 'nothing logged yet',
          told: binding
            ? `Started a timer on "${name}" — it queues for MOCO as "${binding.label}" when stopped. Nothing written to the day's log yet.`
            : `Started a timer on "${name}". No single MOCO task matched, so the time stays local unless one is picked in the panel.`,
        }
      },
      undo: async () => {
        actions.cancelTimer()
        return 'The timer was dropped without logging anything.'
      },
    },

    save_note: {
      schema: schema(
        'save_note',
        "Write a note into today's notes file.",
        { text: string('The note, in the words it should be saved in.') },
        ['text'],
      ),
      run: async ({ text }) => {
        const body = String(text ?? '').trim()
        if (!body) return { failed: 'The note was empty.' }

        await actions.saveNote(body)

        /*
         * The index is read back rather than assumed: it is what Undo deletes, and the
         * day's file is appended to by other things than this chat. A note that cannot be
         * located afterwards is a note this cannot offer to take back.
         */
        const saved = (await readNotes({ limit: 1 }))[0]
        return {
          title: 'Note saved',
          detail: body.length > 90 ? `${body.slice(0, 90)}…` : body,
          told: 'Saved it to today’s notes.',
          index: saved?.index,
          undoable: Number.isInteger(saved?.index),
        }
      },
      undo: async ({ index }) => {
        await actions.deleteNote(index)
        return 'The note was deleted again.'
      },
    },

    stop_timer: {
      schema: schema('stop_timer', 'Stop the running timer and log the time it measured.'),
      /*
       * No `undo`, so this is proposed rather than done: stopping appends to the day's log
       * and queues the stint for MOCO. `propose` only has to describe what the press will
       * do — the press itself runs `run`.
       */
      propose: () => {
        const running = getSnapshot().timer
        if (!running) return { failed: 'No timer is running.' }
        const minutes = Math.round((Date.now() - running.startedAt) / 60_000)
        return {
          title: `Stop “${running.task}”`,
          detail: `logs about ${minutes}m and queues it for MOCO`,
        }
      },
      run: async () => {
        await actions.stopTimer()
        return { told: 'Stopped and logged it.' }
      },
    },

    add_past_time: {
      schema: schema(
        'add_past_time',
        'Log time for work that was done without the timer running.',
        {
          task: string('The task name.'),
          date: string('The day, as YYYY-MM-DD.'),
          duration: string('How long, e.g. "1h 30m", "45m", "1.5h".'),
          description: string('Optional note for MOCO.'),
        },
        ['task', 'date', 'duration'],
      ),
      propose: ({ task, date, duration, description }) => {
        const name = String(task ?? '').trim()
        const minutes = parseDuration(String(duration ?? ''))
        if (!name) return { failed: 'No task name was given.' }
        if (!minutes) return { failed: `"${duration}" is not a duration.` }
        if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date ?? ''))) {
          return { failed: `"${date}" is not a date in YYYY-MM-DD form.` }
        }
        return {
          title: `Add ${duration} on ${date}`,
          detail: `${name}${description ? ` · ${description}` : ''}`,
        }
      },
      run: async (args) => {
        await actions.addManualTime({
          task: String(args.task ?? ''),
          date: String(args.date ?? ''),
          duration: String(args.duration ?? ''),
          description: String(args.description ?? ''),
          binding: null,
        })
        return { told: 'Added it to the log.' }
      },
    },

    push_moco: {
      schema: schema('push_moco', 'Send the queued time entries to MOCO.'),
      propose: () => {
        const { moco } = getSnapshot()
        if (!moco?.connected) return { failed: 'MOCO is not connected.' }
        if (!moco.pending) return { failed: 'Nothing is queued to push.' }
        return {
          title: `Push ${moco.pending} ${moco.pending === 1 ? 'entry' : 'entries'} to MOCO`,
          detail: 'a server keeps these; nothing here can take them back',
        }
      },
      run: async () => {
        await actions.mocoPush()
        return { told: 'Pushed the queue.' }
      },
    },

    read_notes: {
      schema: schema(
        'read_notes',
        "Read notes from a day. Today's are already in the brief; use this for other days.",
        { date: string('The day, as YYYY-MM-DD. Defaults to today.') },
      ),
      read: async ({ date }) => {
        const at = /^\d{4}-\d{2}-\d{2}$/.test(String(date ?? '')) ? isoToDate(date) : new Date()
        if (!at) return `"${date}" is not a date in YYYY-MM-DD form.`

        const notes = await readNotes({ at, limit: 20 })
        if (notes.length === 0) return 'No notes were written that day.'
        return notes.map((note) => `${note.time} ${note.text.replace(/\s+/g, ' ')}`).join('\n')
      },
    },

    /**
     * The clipboard, which the prompt already claims the buddy helps with. Read-only and
     * local, so no card; each clip is shortened to one line because the model only needs
     * to find and describe it, never to quote it whole.
     */
    read_clips: {
      schema: schema(
        'read_clips',
        'Search the clipboard history — text the user copied. Use it for "what did I copy" questions and for finding a copied path, link or snippet.',
        { query: string('Words to look for; leave empty for the most recent copies.') },
      ),
      read: async ({ query }) => {
        if (!readClips) return 'Clipboard history is off — it can be switched on in Settings.'
        const clips = await readClips({ query: String(query ?? ''), limit: 12 })
        if (clips === null) return 'Clipboard history is off — it can be switched on in Settings.'
        if (clips.length === 0) {
          return String(query ?? '').trim()
            ? 'Nothing in the clipboard history contains that.'
            : 'The clipboard history is empty.'
        }
        return clips.map((clip) => clip.text.replace(/\s+/g, ' ').slice(0, 160)).join('\n—\n')
      },
    },

    find_moco_task: {
      schema: schema(
        'find_moco_task',
        'Search the MOCO task list by project, task or customer name.',
        { query: string('Words to look for.') },
        ['query'],
      ),
      read: ({ query }) => {
        const found = searchTasks(String(query ?? ''), 8)
        if (found.length === 0) return 'Nothing in the MOCO task list matches that.'
        return found.map((task) => `${task.customer} · ${task.project} · ${task.task}`).join('\n')
      },
    },
  }

  return tools
}

/** Midday, so no timezone can move the date by a day. */
const isoToDate = (value) => {
  const [year, month, day] = String(value).split('-').map(Number)
  const date = new Date(year, month - 1, day, 12)
  return Number.isNaN(date.getTime()) ? null : date
}

/** What the model is shown: every tool's schema, in a stable order. */
export const toolSchemas = (tools) => Object.values(tools).map((tool) => tool.schema)

/** How a tool behaves, from the shape of its definition — see the note at the top. */
export const kindOf = (tool) =>
  tool.read ? 'read' : tool.undo ? 'undoable' : 'needs-a-press'
