import { parseDuration } from '../storage/duration.js'
import { INVERSE_COMMAND, PLAY_KINDS, describeTrack } from '../music/control.js'
import { formatFile } from '../storage/fileSearch.js'

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
 * Every tool that touches *your records* — time, notes, MOCO — goes through the same
 * `actions` the buttons call, so the chat cannot take a path the UI does not have, and the
 * buddy reacts and the panel refreshes exactly as if you had clicked it yourself.
 *
 * The tools that work the Mac around you — the music players, opening a file — have no
 * button to go through, because there is no record of yours for them to write. They are
 * still held to the same rule: skipping a track is undoable because asking for the
 * previous one takes it back, and opening a file is not, so it waits for a press. What
 * none of them do is reach further than the thing asked for: nothing here runs a shell
 * command, deletes a file, or sends a message on your behalf.
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

/** How each transport command reads on its card, past tense — the act already happened. */
const TRANSPORT_TITLES = Object.freeze({
  play: 'Playing',
  pause: 'Paused',
  next: 'Skipped ahead',
  previous: 'Skipped back',
})

/**
 * `actions` is app.js's action set, and the reads are handed in beside it rather than
 * imported: reaching into storage from here would give the chat a path the buttons do not
 * have, and it would drag electron's `app` into a module that is worth testing under plain
 * node. Built as a function so the session can exist before the actions it drives — app.js
 * wires them in that order.
 */
/** One event as one line a model can quote: 'Tue Sep 09 14:30 — Weekly sync'. */
const formatEvent = (event) => {
  const start = new Date(event.startMs)
  const when = `${start.toDateString().slice(0, 10)} ${start.toTimeString().slice(0, 5)}`
  return `${when} — ${event.title}${event.joinUrl ? ' · has a join link' : ''}${event.location ? ` · ${event.location}` : ''}`
}

export const createTools = ({
  actions,
  getSnapshot,
  readNotes,
  readClips,
  searchTasks,
  searchFiles,
  searchNotes,
  searchMessages,
  music,
  openPath,
  inspectPath,
}) => {
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

    /**
     * The connected calendar, read back — the feed is fetched ahead of time, so this is
     * the snapshot's own list rather than another network call.
     */
    read_calendar: {
      schema: schema(
        'read_calendar',
        'List coming and just-started meetings with their times: next few events, plus anything that started within the last 24 hours. Use for "what is next / what did I miss" questions.',
      ),
      read: () => {
        const calendar = getSnapshot().calendar
        if (!calendar?.connected) {
          return 'No calendar is connected. The user can add a published calendar link in the panel, Cal tab.'
        }
        const events = calendar.upcoming ?? []
        if (events.length === 0) return 'Nothing is on the calendar in the next day or so.'
        return events.map(formatEvent).join('\n')
      },
    },

    /**
     * Spotlight over the user's own files — "search file on local" asked aloud. Paths come
     * back whole, because a path you cannot open is a path not found. The tool is a read:
     * it looks, it never opens, moves or deletes.
     */
    search_files: {
      schema: schema(
        'search_files',
        'Search files on this Mac by name or content words (Spotlight), newest-modified first, with the full path and date of each. folder narrows it: pass ANY folder name — "Downloads", "JuniorDepot", a project folder, or a full path — and it is found for you, so never ask the user where a folder is. folder with no query lists what is in it, which answers "what did I download".',
        {
          query: string('File name or content words to look for, e.g. "16x9_Architekt" or "spec sketch final".'),
          folder: string('Optional: the folder to look in, by name or path — e.g. "Downloads", "JuniorDepot".'),
        },
      ),
      read: async ({ query, folder }) => {
        if (!searchFiles) return 'File search is not available here.'

        const outcome = await searchFiles({
          query: String(query ?? ''),
          folder: String(folder ?? '').trim(),
          limit: 10,
        })
        if (outcome.failed) return outcome.failed

        const where = outcome.dirs?.length
          ? outcome.dirs.length === 1
            ? outcome.dirs[0]
            : `${outcome.dirs.length} folders of that name`
          : null

        if (outcome.files.length === 0) {
          const words = String(query ?? '').trim()
          if (!words) return `${where} is empty.`
          if (where) return `No file in ${where} matches "${words}".`
          return outcome.within
            ? `No file matching "${words}" is anywhere under a folder called "${outcome.within}", and no folder of that name exists.`
            : `No files match "${words}".`
        }

        /*
         * Where it looked, said once above the paths: a search that quietly widened from
         * one folder to the whole Mac would otherwise hand back plausible hits from
         * somewhere else entirely.
         */
        const found = outcome.files.map(formatFile).join('\n')
        if (where) return `In ${where}:\n${found}`
        return outcome.within ? `Nowhere is there a folder called "${outcome.within}", so this is the whole Mac:\n${found}` : found
      },
    },

    /**
     * Notes from any day, found by their words — "what did I write about the kickoff",
     * which names no date and so cannot be answered by read_notes.
     */
    search_notes: {
      schema: schema(
        'search_notes',
        'Search all past notes by their words, newest first. Use this when the user asks what they wrote about something and does not say which day.',
        { query: string('Words the note should contain, e.g. "kickoff schaeffler".') },
        ['query'],
      ),
      read: async ({ query }) => {
        const words = String(query ?? '').trim()
        if (!words) return 'No search words were given.'
        if (!searchNotes) return 'Note search is not available here.'

        const found = await searchNotes(words, 8)
        if (found.length === 0) return `No note contains "${words}".`
        return found
          .map((note) => `${note.date} ${note.time} — ${note.text.replace(/\s+/g, ' ').slice(0, 200)}`)
          .join('\n')
      },
    },

    /**
     * The Messages history on this Mac, read-only.
     *
     * macOS keeps it behind Full Disk Access, so the interesting answer is often the one
     * about permission rather than about messages — it is handed back whole, because "I
     * cannot see your messages" without the reason is a dead end.
     */
    search_messages: {
      schema: schema(
        'search_messages',
        'Search the Messages (iMessage/SMS) history on this Mac for texts containing some words. Read-only: it can find and quote messages, it cannot send one.',
        { query: string('Words to look for, e.g. "dinner friday".') },
        ['query'],
      ),
      read: async ({ query }) => {
        const words = String(query ?? '').trim()
        if (!words) return 'No search words were given.'
        if (!searchMessages) return 'Message search is not available here.'

        const outcome = await searchMessages(words, 10)
        if (outcome.blocked) return outcome.hint
        if (outcome.failed) return outcome.failed
        if (outcome.lines.length === 0) return `No message contains "${words}".`
        return outcome.lines.join('\n')
      },
    },

    /**
     * The transport: play, pause, skip. Undoable because the opposite command is exactly
     * how a person takes it back, and because nothing of the user's is written either way.
     */
    control_music: {
      schema: schema(
        'control_music',
        'Control the music playing on this Mac — play, pause, skip to the next track, or go back to the previous one. Works with whichever of Apple Music or Spotify is already open.',
        {
          command: {
            type: 'string',
            enum: ['play', 'pause', 'next', 'previous'],
            description: 'What the player should do.',
          },
        },
        ['command'],
      ),
      run: async ({ command }) => {
        const wanted = String(command ?? '').trim().toLowerCase()
        if (!music) return { failed: 'Music control is not available here.' }
        if (!INVERSE_COMMAND[wanted]) {
          return { failed: `"${command}" is not one of play, pause, next or previous.` }
        }

        const outcome = await music.command(wanted)
        if (outcome.failed) return { failed: outcome.failed }

        const playing = describeTrack(outcome.track)
        return {
          title: `${TRANSPORT_TITLES[wanted]} · ${outcome.player}`,
          detail: playing ?? 'nothing playing',
          told: playing
            ? `${TRANSPORT_TITLES[wanted]} on ${outcome.player}. Now playing: ${playing}.`
            : `${TRANSPORT_TITLES[wanted]} on ${outcome.player}. Nothing is playing there now.`,
          command: wanted,
        }
      },
      undo: async ({ command }) => {
        const back = INVERSE_COMMAND[command] ?? 'pause'
        const outcome = await music.command(back)
        if (outcome.failed) return outcome.failed
        const playing = describeTrack(outcome.track)
        return playing ? `${TRANSPORT_TITLES[back]} — now playing ${playing}.` : TRANSPORT_TITLES[back]
      },
    },

    /**
     * Putting something specific on: an album, an artist, a playlist, a song.
     *
     * Undo pauses rather than restoring the previous track: a player will say what it is
     * playing but not how to get back to it, so claiming to have put it back would be a
     * lie. The card names what was interrupted instead, which is what a person needs to
     * find it again.
     */
    play_music: {
      schema: schema(
        'play_music',
        'Play a named album, artist, playlist or song from the Apple Music library on this Mac. Use this for "put on <something>" and "change to the new album".',
        {
          name: string('What to play, e.g. "Hounds of Love".'),
          kind: {
            type: 'string',
            enum: [...PLAY_KINDS],
            description: 'What the name refers to. Defaults to album.',
          },
        },
        ['name'],
      ),
      run: async ({ name, kind }) => {
        const wanted = String(name ?? '').trim()
        if (!music) return { failed: 'Music control is not available here.' }
        if (!wanted) return { failed: 'Nothing was named to play.' }

        const what = PLAY_KINDS.includes(String(kind ?? '')) ? String(kind) : 'album'
        const before = await music.current().catch(() => null)
        const outcome = await music.playNamed({ kind: what, name: wanted })
        if (outcome.failed) return { failed: outcome.failed }

        const playing = describeTrack(outcome.track)
        return {
          title: `Playing ${what} · ${wanted}`,
          detail: playing ?? outcome.player,
          told: playing
            ? `Playing ${playing} on ${outcome.player}.`
            : `Asked ${outcome.player} to play the ${what} “${wanted}”.`,
          before: describeTrack(before),
        }
      },
      undo: async ({ before }) => {
        const outcome = await music.command('pause')
        if (outcome.failed) return outcome.failed
        return before ? `Paused. Before this, ${before} was playing.` : 'Paused it again.'
      },
    },

    /**
     * Opening what search_files found. Not undoable — an app that has opened a file has
     * opened it — so it waits for a press, and the press only ever hands a path to macOS
     * to open the way a double-click would. No arguments, no shell, no command.
     */
    open_path: {
      schema: schema(
        'open_path',
        'Open a file, folder or app on this Mac the way a double-click would, or reveal it in Finder. Find the path with search_files first and pass it back whole.',
        {
          path: string('The full path, e.g. "/Users/me/Desktop/spec.pdf".'),
          reveal: {
            type: 'boolean',
            description: 'True to show it in Finder instead of opening it.',
          },
        },
        ['path'],
      ),
      propose: async ({ path, reveal }) => {
        const wanted = String(path ?? '').trim()
        if (!wanted) return { failed: 'No path was given.' }
        if (!openPath || !inspectPath) return { failed: 'Opening files is not available here.' }

        const found = await inspectPath(wanted)
        if (!found.exists) return { failed: `Nothing exists at ${wanted}.` }

        return {
          title: `${reveal ? 'Show in Finder' : 'Open'} · ${found.name}`,
          detail: found.path,
        }
      },
      run: async ({ path, reveal }) => {
        const outcome = await openPath(String(path ?? ''), { reveal: Boolean(reveal) })
        if (outcome.failed) return { told: `That would not open: ${outcome.failed}` }
        return { told: reveal ? 'Shown it in Finder.' : 'Opened it.' }
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
